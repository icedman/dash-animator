/*
  License: GPL v3
*/

const Main = imports.ui.main;
const Dash = imports.ui.dash.Dash;
const Layout = imports.ui.layout;
const Shell = imports.gi.Shell;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Point = imports.gi.Graphene.Point;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const schema_id = Me.imports.prefs.schema_id;
const SettingsKey = Me.imports.prefs.SettingsKey;

const setTimeout = Me.imports.utils.setTimeout;
const setInterval = Me.imports.utils.setInterval;
const clearInterval = Me.imports.utils.clearInterval;
const clearTimeout = Me.imports.utils.clearTimeout;

const MAX_SCALE = 1.5;

class Extension {
  enable() {
    this._addEvents();

    this.dashContainerEvents = [];
    this._findDashContainerIntervalId = setInterval(this._findDashContainer.bind(this), 25);

    this.animationContainer = new St.Widget({ name: 'animationContainer' });
    Main.uiGroup.add_child(this.animationContainer);

    log('dash animator enabled');
  }

  disable() {
    this._removeEvents();
    if (this._findDashContainerIntervalId) {
      clearInterval(this._findDashContainerIntervalId);
      this._findDashContainerIntervalId = null;
    }
    if (this.dashContainer) {
      this.dashContainer.set_reactive(false);
      this.dashContainer.set_track_hover(false);
  
      this.dashContainer.remove_style_class_name('hi');
      this.dashContainer = null;
      this.dash = null;
    }

    if (this.icons) {
      this.icons.forEach((b) => {
        b.remove_style_class_name('hi');
        b._icon.remove_style_class_name('hiddenIcon');
        // b._icon.get_parent().remove_child(b._icon);
        // b.add_child(b._icon);
        b._icon = null;
        b._animIconContainer = null;
      });
      this.icons = [];
    }

    Main.uiGroup.remove_child(this.animationContainer);
    delete this.animationContainer;
    this.animationContainer = null;
    
    log('dash animator disabled');
  }

  _findDashContainer() {
    log('finding dashtodockContainer');
    this.dashContainer = Main.uiGroup.find_child_by_name('dashtodockContainer');
    if (this.dashContainer) {
      clearInterval(this._findDashContainerIntervalId);
      this._findDashContainerIntervalId = null;
      log('container found');

      // this.dashContainer.add_style_class_name('hi');
      this._findDash();
      
      this.dashContainer.set_reactive(true);
      this.dashContainer.set_track_hover(true);

      this.dashContainerEvents.push(this.dashContainer.connect(
        'motion-event',
        this._onMotionEvent.bind(this)
      ));
      this.dashContainerEvents.push(this.dashContainer.connect(
        'enter-event',
        this._onEnterEvent.bind(this)
      ));
      this.dashContainerEvents.push(this.dashContainer.connect(
        'leave-event',
        this._onLeaveEvent.bind(this)
      ));
    }
    return 
  }

  _findDash() {
    if (!this.dashContainer) return;
    this.dash = this.dashContainer.find_child_by_name('dash');
    if (this.dash) {
      log('dash found');
    }
  }

  _findIcons() {
    if (!this.dashContainer || !this.dash) return;

    (this.icons || []).forEach((i) => {
      i._orphan = true;
    });

    let prev = [...(this.icons || [])];

    this.icons = [];
    let children = this.dash.last_child.first_child.last_child.get_children();

    this.dashContainer.cc = children;

    // scrollview children
    children.forEach((c) => {
        let label = c.label;
        let appwell = c.first_child;
        if (!appwell) return; // separator?
        let widget = appwell.first_child;
        let icongrid = widget.first_child;
        let boxlayout = icongrid.first_child;
        let bin = boxlayout.first_child;
        let icon = bin.first_child;

        bin._label = label;
        this.icons.push(bin);
    });

    // apps button
    {
      let apps = this.dash.last_child.last_child;
      let label = apps.label;
      let button = apps.first_child;
      let icongrid = button.first_child;
      let boxlayout = icongrid.first_child;
      let bin = boxlayout.first_child;
      let icon = bin.first_child;
      bin._label = label;
      this.icons.push(bin);
    }

    this.icons.forEach((b) => {
      b._orphan = false;
    });

    let filteredIcons = [];
    prev.forEach((b) => {
      if (b._orphan) {
        this.animationContainer.remove_child(b._animIconContainer);
      } else {
        filteredIcons.push(b);
      }
    });

    // this.icons = filteredIcons;
    this.dash._icons = this.icons;

    // delete orphans
  }

  _addEvents() {
    this._overViewEvents = [];

    this._overViewEvents.push(Main.overview.connect(
      'showing',
      this._onOverviewShowing.bind(this)
    ));
    this._overViewEvents.push(Main.overview.connect(
      'hidden',
      this._onOverviewHidden.bind(this)
    ));

    this._displayEvents = [];
    this._displayEvents.push(global.display.connect(
      'notify::focus-window',
      this._onFocusWindow.bind(this)
    ));
    this._displayEvents.push(global.display.connect(
      'in-fullscreen-changed',
      this._onFullScreen.bind(this)
    ));
  }

  _removeEvents() {
    this._overViewEvents.forEach((id) => {
      Main.overview.disconnect(id);
    });
    this._overViewEvents = [];

    this._displayEvents.forEach((id) => {
      global.display.disconnect(id);
    });
    this._displayEvents = [];

    this.dashContainerEvents.forEach((id) => {
      this.dashContainer.disconnect(id);
    })
  }

  _onOverviewShowing() {
    log('_onOverviewShowing');
  }

  _onOverviewHidden() {
    log('_onOverviewHidden');
  }

  _onFocusWindow() {
    // log('_onFocusWindow');
    this._animate();
  }

  _onMotionEvent() {
    // log('_onMotionEvent');
    this._animate();
  }
  _onEnterEvent() {
    // log('_onEnterEvent');
    this._animate();
  } 
  _onLeaveEvent() {
    // log('_onLeaveEvent');
    this._animate();
  }

  _onFullScreen() {
    log('_onFullScreen');
  }

  _animate() {
    if (!this.animationContainer || !this.dashContainer) return;

    let pointer = global.get_pointer();

    let nearestIcon = null;
    let nearestDistance = -1;

    this._findIcons();

    let pos = this.dashContainer.get_position();
    pos[1] -= this.dashContainer.size.height;

    let pad = this.dashContainer.size.height * 0.2;
    this.animationContainer.set_position(pos[0], pos[1] - pad);
    this.animationContainer.size = this.dashContainer.size;

    this.dashContainer._icons = this.icons;

    this.icons.forEach((b) => {
      if (!b._animIconContainer) {
        b._animIconContainer = new St.Icon({ name: 'animIcon' });
        let icon_name = b.first_child.get_icon_name();
        if (icon_name) {
          b._animIconContainer.icon_name = icon_name;
        } else {
          b._animIconContainer.set_gicon(b.first_child.get_gicon());
        }
        // b._animIconContainer.add_style_class_name('hi');
        this.animationContainer.add_child(b._animIconContainer);
      }

      let bpos = this._get_position(b);

      let bposcenter = [...bpos];
      bposcenter[0] += b.first_child.size.width/2;
      bposcenter[1] -= b.first_child.size.height/2;
      let dst = this._get_distance(pointer, bposcenter);
      if (nearestDistance == -1 || nearestDistance > dst) {
        nearestDistance = dst;
        nearestIcon = b;
      }

      bpos[0] -= pos[0];
      bpos[1] -= pos[1];
      bpos[1] -= this.dashContainer.size.height;
      bpos[1] += pad;
      b._animIconContainer.set_position(bpos[0], bpos[1]);

      if (!b._icon) {
        b._icon = b.first_child;
        b._icon.hide();
        b.size = b._icon.size;
      }

      b._animIconContainer.size = b._icon.size;
      b._animIconContainer.set_scale(1,1);

      let labelY = this._get_y(b._animIconContainer);
      b._label.y = labelY;
    });

    if (nearestIcon && nearestDistance < 90) {
      // log(nearestDistance);

      let pos = nearestIcon._animIconContainer.get_position();
      nearestIcon._animIconContainer.set_position(pos[0], pos[1] - 20);

      let pivot = new Point();
      pivot.x = 0.5;
      pivot.y = 0.5;

      nearestIcon._animIconContainer.pivot_point = pivot;
      nearestIcon._animIconContainer.set_scale(MAX_SCALE, MAX_SCALE);

      let labelY = this._get_y(nearestIcon._animIconContainer);
      nearestIcon._label.y = labelY - (nearestIcon._animIconContainer.size.height * MAX_SCALE) * 0.75;
    }
  }

  _get_x(obj) {
    if (obj == null) return 0;
    let x = obj.get_position()[0];
    let parent = obj.get_parent();
    if (parent) return x + this._get_x(parent);
    return x;
  }

  _get_y(obj) {
    if (obj == null) return 0;
    let y = obj.get_position()[1];
    let parent = obj.get_parent();
    if (parent) return y + this._get_y(parent);
    return y;
  }

  _get_position(obj) {
    return [ this._get_x(obj), this._get_y(obj)];
  }

  _get_distance_sqr(pos1, pos2) {
    let a = pos1[0] - pos2[0];
    let b = pos1[1] - pos2[1];
    return (a * a) + (b * b);
  }

  _get_distance(pos1, pos2) {
    return Math.sqrt(this._get_distance_sqr(pos1, pos2));
  }
}

function init() {
  return new Extension();
}
