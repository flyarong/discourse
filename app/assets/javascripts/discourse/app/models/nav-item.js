import Category from "discourse/models/category";
import EmberObject from "@ember/object";
import I18n from "I18n";
import Site from "discourse/models/site";
import User from "discourse/models/user";
import { deepMerge } from "discourse-common/lib/object";
import deprecated from "discourse-common/lib/deprecated";
import discourseComputed from "discourse-common/utils/decorators";
import { emojiUnescape } from "discourse/lib/text";
import { getOwner } from "discourse-common/lib/get-owner";
import getURL from "discourse-common/lib/get-url";
import { reads } from "@ember/object/computed";

const NavItem = EmberObject.extend({
  @discourseComputed("name")
  title(name) {
    return I18n.t("filters." + name.replace("/", ".") + ".help", {});
  },

  @discourseComputed("name", "count")
  displayName(name, count) {
    count = count || 0;

    if (
      name === "latest" &&
      (!Site.currentProp("mobileView") || this.tagId !== undefined)
    ) {
      count = 0;
    }

    let extra = { count: count };
    const titleKey = count === 0 ? ".title" : ".title_with_count";

    return emojiUnescape(
      I18n.t(`filters.${name.replace("/", ".") + titleKey}`, extra)
    );
  },

  @discourseComputed("filterType", "category", "noSubcategories", "tagId")
  href(filterType, category, noSubcategories, tagId) {
    let customHref = null;

    NavItem.customNavItemHrefs.forEach(function (cb) {
      customHref = cb.call(this, this);
      if (customHref) {
        return false;
      }
    }, this);

    if (customHref) {
      return getURL(customHref);
    }

    const context = { category, noSubcategories, tagId };
    return NavItem.pathFor(filterType, context);
  },

  filterType: reads("name"),

  @discourseComputed("name", "category", "noSubcategories")
  filterMode(name, category, noSubcategories) {
    let mode = "";
    if (category) {
      mode += "c/";
      mode += Category.slugFor(category);
      if (noSubcategories) {
        mode += "/none";
      }
      mode += "/l/";
    }
    return mode + name.replace(" ", "-");
  },

  @discourseComputed(
    "name",
    "category",
    "tagId",
    "noSubcategories",
    "topicTrackingState.messageCount"
  )
  count(name, category, tagId, noSubcategories) {
    const state = this.topicTrackingState;
    if (state) {
      return state.lookupCount(name, category, tagId, noSubcategories);
    }
  },
});

const ExtraNavItem = NavItem.extend({
  href: discourseComputed("href", {
    get() {
      if (this._href) {
        return this._href;
      }

      return this.href;
    },

    set(key, value) {
      return (this._href = value);
    },
  }),

  count: 0,

  customFilter: null,
});

NavItem.reopenClass({
  extraArgsCallbacks: [],
  customNavItemHrefs: [],
  extraNavItemDescriptors: [],

  pathFor(filterType, context) {
    let path = getURL("");
    let includesCategoryContext = false;
    let includesTagContext = false;

    if (filterType === "categories") {
      path += "/categories";
      return path;
    }

    if (context.tagId && Site.currentProp("filters").includes(filterType)) {
      includesTagContext = true;

      if (context.category) {
        path += "/tags";
      } else {
        path += "/tag";
      }
    }

    if (context.category) {
      includesCategoryContext = true;
      path += `/c/${Category.slugFor(context.category)}/${context.category.id}`;

      if (context.noSubcategories) {
        path += "/none";
      }
    }

    if (includesTagContext) {
      path += `/${context.tagId}`;
    }

    if (includesTagContext || includesCategoryContext) {
      path += "/l";
    }

    path += `/${filterType}`;

    // In the case of top, the nav item doesn't include a period because the
    // period has its own selector just below

    return path;
  },

  // Create a nav item given a filterType. It returns null if there is not
  // valid nav item. The name is a historical artifact.
  fromText(filterType, opts) {
    const anonymous = !User.current();

    opts = opts || {};

    if (anonymous) {
      const topMenuItems = Site.currentProp("anonymous_top_menu_items");
      if (!topMenuItems || !topMenuItems.includes(filterType)) {
        return null;
      }
    }

    if (!Category.list() && filterType === "categories") {
      return null;
    }
    if (!Site.currentProp("top_menu_items").includes(filterType)) {
      return null;
    }

    let args = { name: filterType, hasIcon: filterType === "unread" };
    if (opts.category) {
      args.category = opts.category;
    }
    if (opts.tagId) {
      args.tagId = opts.tagId;
    }
    if (opts.currentRouteQueryParams) {
      args.currentRouteQueryParams = opts.currentRouteQueryParams;
    }
    if (opts.noSubcategories) {
      args.noSubcategories = true;
    }
    NavItem.extraArgsCallbacks.forEach((cb) =>
      deepMerge(args, cb.call(this, filterType, opts))
    );

    let store = getOwner(this).lookup("service:store");
    return store.createRecord("nav-item", args);
  },

  buildList(category, args) {
    args = args || {};

    if (category) {
      args.category = category;
    }

    if (!args.siteSettings) {
      deprecated("You must supply `buildList` with a `siteSettings` object", {
        since: "2.6.0",
        dropFrom: "2.7.0",
      });
      args.siteSettings = getOwner(this).lookup("site-settings:main");
    }
    let items = args.siteSettings.top_menu.split("|");

    const filterType = (args.filterMode || "").split("/").pop();

    if (!items.some((i) => filterType === i)) {
      items.push(filterType);
    }

    items = items
      .map((i) => NavItem.fromText(i, args))
      .filter(
        (i) =>
          i !== null && !(category && i.get("name").indexOf("categor") === 0)
      );

    const context = {
      category: args.category,
      tagId: args.tagId,
      noSubcategories: args.noSubcategories,
    };

    const extraItems = NavItem.extraNavItemDescriptors
      .map((descriptor) =>
        ExtraNavItem.create(deepMerge({}, context, descriptor))
      )
      .filter((item) => {
        if (!item.customFilter) {
          return true;
        }
        return item.customFilter(category, args);
      });

    let forceActive = false;

    extraItems.forEach((item) => {
      if (item.init) {
        item.init(item, category, args);
      }

      if (item.href) {
        item.href = getURL(item.href);
      }

      const before = item.before;
      if (before) {
        let i = 0;
        for (i = 0; i < items.length; i++) {
          if (items[i].name === before) {
            break;
          }
        }
        items.splice(i, 0, item);
      } else {
        items.push(item);
      }

      if (item.customHref) {
        item.set("href", item.customHref(category, args));
      }

      if (item.forceActive && item.forceActive(category, args)) {
        item.active = true;
        forceActive = true;
      } else {
        item.active = undefined;
      }
    });

    if (forceActive) {
      items.forEach((i) => {
        if (i.active === undefined) {
          i.active = false;
        }
      });
    }
    return items;
  },
});

export default NavItem;

export function extraNavItemProperties(cb) {
  NavItem.extraArgsCallbacks.push(cb);
}

export function customNavItemHref(cb) {
  NavItem.customNavItemHrefs.push(cb);
}

export function clearCustomNavItemHref() {
  NavItem.customNavItemHrefs.clear();
}

export function addNavItem(item) {
  NavItem.extraNavItemDescriptors.push(item);
}
