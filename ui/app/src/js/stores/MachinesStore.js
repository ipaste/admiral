/*
 * Copyright (c) 2016 VMware, Inc. All Rights Reserved.
 *
 * This product is licensed to you under the Apache License, Version 2.0 (the "License").
 * You may not use this product except in compliance with the License.
 *
 * This product may include a number of subcomponents with separate copyright notices
 * and license terms. Your use of these subcomponents is subject to the terms and
 * conditions of the subcomponent's license, as noted in the LICENSE file.
 */

import * as actions from 'actions/Actions';
import constants from 'core/constants';
import links from 'core/links';
import services from 'core/services';
import utils from 'core/utils';
import CrudStoreMixin from 'stores/mixins/CrudStoreMixin';
import ContextPanelStoreMixin from 'stores/mixins/ContextPanelStoreMixin';
import NotificationsStore from 'stores/NotificationsStore';
import RequestsStore from 'stores/RequestsStore';
import EventLogStore from 'stores/EventLogStore';
import PlacementZonesStore from 'stores/PlacementZonesStore';

const OPERATION = {
  LIST: 'LIST',
  DETAILS: 'DETAILS'
};

let toViewModel = function(dto) {
  var customProperties = [];
  let hasCustomProperties = dto.customProperties && dto.customProperties !== null;
  if (hasCustomProperties) {
    for (var key in dto.customProperties) {
      if (dto.customProperties.hasOwnProperty(key)) {
        customProperties.push({
          name: key,
          value: dto.customProperties[key]
        });
      }
    }
  }
  return $.extend({}, dto, {
    dto: dto,
    selfLinkId: utils.getDocumentId(dto.documentSelfLink),
    placementZoneDocumentId: dto.resourcePoolLink && utils.getDocumentId(dto.resourcePoolLink),
    connectionType: hasCustomProperties ? dto.customProperties.__adapterDockerType : null,
    customProperties: customProperties
  });
};

let onOpenToolbarItem = function(name, data, shouldSelectAndComplete) {
  var contextViewData = {
    expanded: true,
    activeItem: {
      name: name,
      data: data
    },
    shouldSelectAndComplete: shouldSelectAndComplete
  };

  this.setInData(['editingItemData', 'contextView'], contextViewData);
  this.emitChange();
};

let isContextPanelActive = function(name) {
  var activeItem = this.data.editingItemData.contextView &&
      this.data.editingItemData.contextView.activeItem;
  return activeItem && activeItem.name === name;
};

let MachinesStore = Reflux.createStore({
  mixins: [ContextPanelStoreMixin, CrudStoreMixin],

  init() {

    NotificationsStore.listen((notifications) => {
      if (this.data.hostAddView) {
        return;
      }

      this.setInData(['contextView', 'notifications', constants.CONTEXT_PANEL.REQUESTS],
        notifications.runningRequestItemsCount);

      this.setInData(['contextView', 'notifications', constants.CONTEXT_PANEL.EVENTLOGS],
        notifications.latestEventLogItemsCount);

      this.emitChange();
    });

    RequestsStore.listen((requestsData) => {
      if (this.data.hostAddView) {
        return;
      }

      if (this.isContextPanelActive(constants.CONTEXT_PANEL.REQUESTS)) {
        this.setActiveItemData(requestsData);
        this.emitChange();
      }
    });

    EventLogStore.listen((eventlogsData) => {
      if (this.data.hostAddView) {
        return;
      }

      if (this.isContextPanelActive(constants.CONTEXT_PANEL.EVENTLOGS)) {
        this.setActiveItemData(eventlogsData);
        this.emitChange();
      }
    });

    PlacementZonesStore.listen((placementZonesData) => {
      if (!this.data.editingItemData) {
        return;
      }

      if (placementZonesData.items !== constants.LOADING) {
        this.setInData(['editingItemData', 'placementZones'], placementZonesData.items);
      }

      if (isContextPanelActive.call(this, constants.CONTEXT_PANEL.PLACEMENT_ZONES)) {
        this.setInData(['editingItemData', 'contextView', 'activeItem', 'data'],
          placementZonesData);

        var itemToSelect = placementZonesData.newItem || placementZonesData.updatedItem;
        if (itemToSelect && this.data.editingItemData.contextView.shouldSelectAndComplete) {
          clearTimeout(this.itemSelectTimeout);
          this.itemSelectTimeout = setTimeout(() => {
            this.setInData(['editingItemData', 'placementZone'], itemToSelect);
            this.onCloseToolbar();
          }, constants.VISUALS.ITEM_HIGHLIGHT_ACTIVE_TIMEOUT);
        }
      }
      this.emitChange();
    });
  },

  listenables: [actions.MachineActions, actions.MachinesContextToolbarActions],

  onOpenMachines(queryOptions, forceReload) {
    var items = utils.getIn(this.data, ['listView', 'items']);
    if (!forceReload && items) {
      return;
    }

    this.setInData(['editingItemData'], null);
    this.setInData(['selectedItem'], null);
    this.setInData(['selectedItemDetails'], null);
    this.setInData(['listView', 'queryOptions'], queryOptions);

    var operation = this.requestCancellableOperation(OPERATION.LIST, queryOptions);

    if (operation) {
      this.cancelOperations(OPERATION.DETAILS);
      this.setInData(['listView', 'itemsLoading'], true);

      operation.forPromise(services.loadMachines(queryOptions, false)).then((result) => {
        var documents = result.documentLinks.map((documentLink) =>
              result.documents[documentLink]);
        var nextPageLink = result.nextPageLink;
        var itemsCount = result.totalCount;
        var machines = documents.map((document) => toViewModel(document));

        this.getPlacementZones(machines).then((result) => {
          machines.forEach((machine) => {
            if (result[machine.resourcePoolLink]) {
              machine.placementZoneName =
                 result[machine.resourcePoolLink].resourcePoolState.name;
            }
          });
          return this.getDescriptions(machines);
        }).then((result) => {

          machines.forEach((machine) => {
            if (result[machine.descriptionLink]) {
              machine.instanceType = result[machine.descriptionLink].instanceType;
              machine.cpuCount = result[machine.descriptionLink].cpuCount;
              machine.cpuMhzPerCore = result[machine.descriptionLink].cpuMhzPerCore;
              machine.memory =
                  Math.floor(result[machine.descriptionLink].totalMemoryBytes / 1048576);
            }
          });

          this.setInData(['listView', 'items'], machines);
          this.setInData(['listView', 'itemsLoading'], false);
          if (itemsCount !== undefined && itemsCount !== null) {
            this.setInData(['listView', 'itemsCount'], itemsCount);
          }
          this.setInData(['listView', 'nextPageLink'], nextPageLink);
          this.emitChange();
        });
      });
    }

    this.emitChange();
  },
  onOpenMachinesNext(queryOptions, nextPageLink) {
    this.setInData(['listView', 'queryOptions'], queryOptions);

    var operation = this.requestCancellableOperation(OPERATION.LIST, queryOptions);

    if (operation) {
      this.cancelOperations(OPERATION.DETAILS);
      this.setInData(['listView', 'itemsLoading'], true);

      operation.forPromise(services.loadNextPage(nextPageLink)).then((result) => {
        var documents = result.documentLinks.map((documentLink) =>
              result.documents[documentLink]);
        var nextPageLink = result.nextPageLink;
        let machines = documents.map((document) => toViewModel(document));

        this.getPlacementZones(machines).then((result) => {
          machines.forEach((machine) => {
            if (result[machine.resourcePoolLink]) {
              machine.placementZoneName =
                 result[machine.resourcePoolLink].resourcePoolState.name;
            }
          });
          return this.getDescriptions(machines);
        }).then((result) => {

          machines.forEach((machine) => {
            if (result[machine.descriptionLink]) {
              machine.instanceType = result[machine.descriptionLink].instanceType;
              machine.cpuCount = result[machine.descriptionLink].cpuCount;
              machine.cpuMhzPerCore = result[machine.descriptionLink].cpuMhzPerCore;
              machine.memory =
                  Math.floor(result[machine.descriptionLink].totalMemoryBytes / 1048576);
            }
          });

          this.setInData(['listView', 'items'],
              utils.mergeDocuments(this.data.listView.items.asMutable(), machines));
          this.setInData(['listView', 'itemsLoading'], false);
          this.setInData(['listView', 'nextPageLink'], nextPageLink);
          this.emitChange();
        });
      });
    }
    this.emitChange();
  },
  onOpenAddMachine() {
    this.setInData(['editingItemData', 'item'], {});
    this.emitChange();
  },
  onOpenMachineDetails: function(machineId) {
    var itemDetailsCursor = this.selectFromData(['selectedItemDetails']);
    itemDetailsCursor.merge({
      documentSelfLink: '/resources/compute/' + machineId,
      machineId: machineId
    });

    var machine = null;

    services.loadHost(machineId).then((document) => {
      machine = toViewModel(document);

      machine.displayCustomProperties =
        machine.customProperties.filter((property) => !property.name.startsWith('_'));

      var findCustomProperty = function(customPropertyName) {
        for (var i = 0; i < machine.customProperties.length; i++) {
          var customProperty = machine.customProperties[i];
          if (customProperty.name === customPropertyName) {
            return customProperty.value;
          }
        }

        return null;
      };

      let promises = [];

      // get machine descriptors
      promises.push(this.getDescriptions([machine]).catch(() => Promise.resolve()));

      // get endpoint details
      promises.push(services.loadEndpoint(machine.endpointLink).catch(() => Promise.resolve()));

      // get placement zone
      promises.push(this.getPlacementZones([machine]).catch(() => Promise.resolve()));

      // get parent compute
      var placementLink = findCustomProperty('__placementLink');
      if (placementLink) {
        promises.push(services.loadHostByLink(placementLink).catch(() => Promise.resolve()));
      } else {
        promises.push(Promise.resolve());
      }

      // get profile
      let profileLink = findCustomProperty('__profileLink');
      if (profileLink) {
        promises.push(services.loadHostByLink(profileLink).catch(() => Promise.resolve()));
      } else {
        promises.push(Promise.resolve());
      }

      return Promise.all(promises).then(
          ([descriptors, endpoint, placementZones, parent, profile]) => {
        // calculate stats
        let memory = descriptors[machine.descriptionLink].totalMemoryBytes;

        machine.stats = {
          cpuCount: descriptors[machine.descriptionLink].cpuCount,
          cpuMhzPerCore: descriptors[machine.descriptionLink].cpuMhzPerCore,
          cpuUsage: this.getRandomArbitrary(0, 100),         // random
          memory: memory,
          memoryUsage: this.getRandomArbitrary(0, memory)       //random
        };

        machine.endpoint = endpoint;

        machine.placementZoneName =
                 placementZones[machine.resourcePoolLink].resourcePoolState.name;

        // get parent name
        if (parent) {
          machine.parentName = parent.name;
        }

        // get profile name
        if (profile) {
          machine.profileName = profile.name;
        }

        itemDetailsCursor.setIn(['instance'], machine);
        this.emitChange();
      });
    }).catch(this.onGenericDetailsError);
  },
  onGenericDetailsError(e) {
    console.error(e);

    var validationErrors = utils.getValidationErrors(e);
    this.setInData(['selectedItemDetails', 'validationErrors'], validationErrors);

    this.emitChange();
  },
  onRefreshMachineDetails: function() {
    var machineId = this.selectFromData(['selectedItemDetails']).getIn('machineId');

    this.onOpenMachineDetails(machineId);
  },
  onCreateMachine(templateContent) {
    services.importContainerTemplate(templateContent).then((templateSelfLink) => {
      let documentId = utils.getDocumentId(templateSelfLink);
      return services.loadContainerTemplate(documentId);
    }).then((template) => {
      return services.createMachine(template);
    }).then((request) => {
      actions.NavigationActions.openMachines();
      this.openToolbarItem(constants.CONTEXT_PANEL.REQUESTS, RequestsStore.getData());
      actions.RequestsActions.requestCreated(request);
      this.setInData(['editingItemData'], null);
      this.emitChange();
    }).catch(this.onGenericEditError);

    this.setInData(['editingItemData', 'item'], {});
    this.setInData(['editingItemData', 'validationErrors'], null);
    this.setInData(['editingItemData', 'saving'], true);
    this.emitChange();
  },
  onEditMachine(machineId) {
    services.loadHost(machineId).then((document) => {
      let model = toViewModel(document);
      actions.PlacementZonesActions.retrievePlacementZones();

      let promises = [];
      if (document.resourcePoolLink) {
        promises.push(
            services.loadPlacementZone(document.resourcePoolLink).catch(() => Promise.resolve()));
      } else {
        promises.push(Promise.resolve());
      }

      if (document.tagLinks && document.tagLinks.length) {
        promises.push(
            services.loadTags(document.tagLinks).catch(() => Promise.resolve()));
      } else {
        promises.push(Promise.resolve());
      }

      Promise.all(promises).then(([config, tags]) => {
        if (document.resourcePoolLink && config) {
          model.placementZone = config.resourcePoolState;
        }
        model.tags = tags ? Object.values(tags) : [];

        this.setInData(['editingItemData', 'item'], model);
        this.emitChange();
      });

    }).catch(this.onGenericEditError);

    this.setInData(['editingItemData', 'item'], {
      documentSelfLink: links.COMPUTE_RESOURCES + '/' + machineId
    });
    this.emitChange();
  },
  onUpdateMachine(model, tagRequest) {
    let patchData = {
      resourcePoolLink: model.resourcePoolLink || constants.NO_LINK_VALUE
    };

    Promise.all([
        services.updateMachine(model.selfLinkId, patchData),
        services.updateTagAssignment(tagRequest)
    ]).then(() => {
      actions.NavigationActions.openMachines();
      this.setInData(['editingItemData'], null);
      this.emitChange();
    }).catch(this.onGenericEditError);

    this.setInData(['editingItemData', 'item'], model);
    this.setInData(['editingItemData', 'validationErrors'], null);
    this.setInData(['editingItemData', 'saving'], true);
    this.emitChange();
  },
  onOperationCompleted() {
    this.onOpenMachines(this.data.listView && this.data.listView.queryOptions, true);
  },
  onGenericEditError(e) {
    var validationErrors = utils.getValidationErrors(e);
    this.setInData(['editingItemData', 'validationErrors'], validationErrors);
    this.setInData(['editingItemData', 'saving'], false);
    console.error(e);
    this.emitChange();
  },
  onOpenToolbarRequests() {
    actions.RequestsActions.openRequests();
    this.openToolbarItem(constants.CONTEXT_PANEL.REQUESTS, RequestsStore.getData());

  },
  onOpenToolbarEventLogs(highlightedItemLink) {
    actions.EventLogActions.openEventLog(highlightedItemLink);
    this.openToolbarItem(constants.CONTEXT_PANEL.EVENTLOGS, EventLogStore.getData());
  },
  onOpenToolbarPlacementZones() {
    onOpenToolbarItem.call(this, constants.CONTEXT_PANEL.PLACEMENT_ZONES,
      PlacementZonesStore.getData(), false);
  },
  onCloseToolbar() {
    if (!this.data.editingItemData) {
      this.closeToolbar();
    } else {
      let contextViewData = {
        expanded: false,
        activeItem: null
      };
      this.setInData(['editingItemData', 'contextView'], contextViewData);
      this.emitChange();
    }
  },
  onCreatePlacementZone() {
    onOpenToolbarItem.call(this, constants.CONTEXT_PANEL.PLACEMENT_ZONES,
      PlacementZonesStore.getData(), true);
    actions.PlacementZonesActions.editPlacementZone({});
  },
  onManagePlacementZones() {
    onOpenToolbarItem.call(this, constants.CONTEXT_PANEL.PLACEMENT_ZONES,
      PlacementZonesStore.getData(), true);
  },
  getPlacementZones(machines) {
    let placementZones = utils.getIn(this.data, ['listView', 'placementZones']) || [];
    let resourcePoolLinks = machines.filter((machine) =>
        machine.resourcePoolLink).map((machine) => machine.resourcePoolLink);
    let links = [...new Set(resourcePoolLinks)].filter((link) =>
        !placementZones.hasOwnProperty(link));
    if (links.length === 0) {
      return Promise.resolve(placementZones);
    }
    return services.loadPlacementZones(links).then((newPlacementZones) => {
      this.setInData(['listView', 'placementZones'],
          $.extend({}, placementZones, newPlacementZones));
      return utils.getIn(this.data, ['listView', 'placementZones']);
    });
  },
  getDescriptions(machines) {
    let descriptions = utils.getIn(this.data, ['listView', 'descriptions']) || [];
    let descriptionLinks = machines.filter((machine) =>
        machine.descriptionLink).map((machine) => machine.descriptionLink);
    let links = [...new Set(descriptionLinks)].filter((link) =>
        !descriptions.hasOwnProperty(link));
    if (links.length === 0) {
      return Promise.resolve(descriptions);
    }
    return services.loadHostDescriptions(links).then((newDescriptions) => {
      this.setInData(['listView', 'descriptions'], $.extend({}, descriptions, newDescriptions));
      return utils.getIn(this.data, ['listView', 'descriptions']);
    });
  },

  // TODO: delete once we have a real data
  getRandomArbitrary(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
  }
});

export default MachinesStore;
