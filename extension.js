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

const MAX_SCALE = 1.8;

class Extension {
  enable() {
    this._addEvents();

    this.dashContainerEvents = [];

    if (this._findDashContainer()) {
      this._coldStartId = setTimeout(this._onEnterEvent.bind(this), 500);
    } else {
      this._startUpId = Main.layoutManager.connect(
        'startup-complete',
        this._onEnterEvent.bind(this)
      );
    }

    this._autoHideSpyId = setInterval(this._onAutoHideSpyEvent.bind(this), 250);

    this.animationContainer = new St.Widget({ name: 'animationContainer' });
    Main.uiGroup.add_child(this.animationContainer);

    log('dash animator enabled');
  }

  disable() {
    this._removeEvents();

    if (this._coldStartId) {
      log('_coldStartId');
      clearInterval(this._coldStartId);
      this._coldStartId = null;
    }

    if (this._startUpId) {
      log('_startUpId');
      Main.layoutManager.disconnect(this._startUpId);
      this._startUpId = null;
    }

    if (this._autoHideSpyId) {
      log('_autoHideSpyId');
      clearInterval(this._autoHideSpyId);
      this._autoHideSpyId = null;
    }

    if (this._intervalId) {
      log('_intervalId');
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    if (this._timeoutId) {
      log('_timeoutId');
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }

    if (this.dashContainer) {
      this.dashContainer.set_reactive(false);
      this.dashContainer.set_track_hover(false);
      this.dashContainer.remove_style_class_name('hi');
      this.dashContainer = null;
      this.dash = null;
    }

    if (this.icons) {
      try {
        this.icons.forEach((b) => {
          if (!b._icon) return;
          b._icon.show();
          b.size = null;
          b._icon = null;
          b._animIconContainer.set_gicon(null);
          b._animIconContainer.icon_name = null;
          b._animIconContainer = null;
          b._orphan = false;

          if (!this._dragging && b._draggable) {
            if (b._draggable._dragBeginId) {
              b._draggable.disconnect(b._draggable._dragBeginId);
              b._draggable._dragBeginId = null;
            }
            if (b._draggable._dragEndId) {
              b._draggable.disconnect(b._draggable._dragEndId);
              b._draggable._dragEndId = null;
            }
            b._draggable = null;
          }
        });
      } catch (err) {
        //
      }

      this.icons = [];
    }

    if (this.animationContainer) {
      Main.uiGroup.remove_child(this.animationContainer);
      this.animationContainer = null;
    }

    log('dash animator disabled');
  }

  _findDashContainer() {
    log('finding dashtodockContainer');
    this.dashContainer = Main.uiGroup.find_child_by_name('dashtodockContainer');
    if (this.dashContainer) {
      log('container found');

      // this.dashContainer.add_style_class_name('hi');
      this._findDash();

      this.dashContainer.set_reactive(true);
      this.dashContainer.set_track_hover(true);

      this.dashContainerEvents.push(
        this.dashContainer.connect(
          'motion-event',
          this._onMotionEvent.bind(this)
        )
      );
      this.dashContainerEvents.push(
        this.dashContainer.connect('enter-event', this._onEnterEvent.bind(this))
      );
      this.dashContainerEvents.push(
        this.dashContainer.connect('leave-event', this._onLeaveEvent.bind(this))
      );
      this.dashContainerEvents.push(
        this.dashContainer.connect('destroy', this._restart.bind(this))
      );

      return true;
    }
    return false;
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

    if (!this.icons) {
      this.icons = [];
    }
    let children = this.dash.last_child.first_child.last_child.get_children();

    this.icons.forEach((i) => {
      i._orphan = true;
    });

    let new_icons = [];

    // scrollview children
    children.forEach((c) => {
      let label = c.label;
      let appwell = c.first_child;
      if (!appwell) return; // separator?

      let draggable = appwell._draggable;
      let widget = appwell.first_child;
      let icongrid = widget.first_child;
      let boxlayout = icongrid.first_child;
      let bin = boxlayout.first_child;
      let icon = bin.first_child;

      bin._draggable = draggable;
      bin._label = label;
      bin._orphan = false;
      new_icons.push(bin);

      if (draggable && !draggable._dragBeginId) {
        draggable._dragBeginId = draggable.connect('drag-begin', () => {
          this._dragging = true;
          this.disable();
        });
        draggable._dragEndId = draggable.connect('drag-end', () => {
          this._dragging = false;
          this.enable();
        });
      }
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
      bin._orphan = false;
      new_icons.push(bin);
    }

    let filteredIcons = [];
    this.icons.forEach((b) => {
      if (b._orphan) {
        b._animIconContainer.set_gicon(null);
        b._animIconContainer.icon_name = null;
        this.animationContainer.remove_child(b._animIconContainer);
      }
    });

    this.icons = new_icons;
    this.dash._icons = this.icons;
  }

  _addEvents() {
    this._overViewEvents = [];

    this._overViewEvents.push(
      Main.overview.connect('showing', this._onOverviewShowing.bind(this))
    );
    this._overViewEvents.push(
      Main.overview.connect('hidden', this._onOverviewHidden.bind(this))
    );

    this._displayEvents = [];
    this._displayEvents.push(
      global.display.connect(
        'notify::focus-window',
        this._onFocusWindow.bind(this)
      )
    );
    this._displayEvents.push(
      global.display.connect(
        'in-fullscreen-changed',
        this._onFullScreen.bind(this)
      )
    );
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
    });
    this.dashContainerEvents = [];
  }

  _onOverviewShowing() {
    log('_onOverviewShowing');
  }

  _onOverviewHidden() {
    log('_onOverviewHidden');
  }

  _onMotionEvent() {
    this._onEnterEvent();
  }

  _onEnterEvent() {
    if (this._coldStartId) {
      clearInterval(this._coldStartId);
      this._coldStartId = null;
    }
    this._inDash = true;
    this._beginAnimation();
    this._debounceEndAnimation();
  }

  _onLeaveEvent() {
    this._inDash = false;
    this._debounceEndAnimation();
  }

  _onFocusWindow() {
    this._beginAnimation();
    this._debounceEndAnimation();
  }

  _onFullScreen() {
    log('_onFullScreen');
  }

  _restart() {
    log('restart');
    this.disable();
    this.enable();
  }

  _animate() {
    if (!this.dashContainer) {
      this._findDashContainer();
    }
    if (!this.dashContainer) return;

    let dockPosition = this._queryPosition();
    let pointer = global.get_pointer();

    let nearestIdx = -1;
    let nearestIcon = null;
    let nearestDistance = -1;

    this._findIcons();

    let pos = this.dashContainer.get_position();
    pos[1] -= this.dashContainer.size.height;

    this.animationContainer.set_position(pos[0], pos[1]);
    this.animationContainer.size = this.dashContainer.size;

    this.dashContainer._icons = this.icons;

    let pivot = new Point();
    pivot.x = 0.5;
    pivot.y = 0.5;

    let idx = 0;
    this.icons.forEach((b) => {
      if (!b._animIconContainer) {
        b._animIconContainer = new St.Icon({ name: 'animIcon' });
        let icon_name = b.first_child.get_icon_name();
        if (icon_name) {
          b._animIconContainer.icon_name = icon_name;
        } else {
          b._animIconContainer.set_gicon(b.first_child.get_gicon());
        }
        this.animationContainer.add_child(b._animIconContainer);
      }

      b._animIconContainer.pivot_point = pivot;
      let bpos = this._get_position(b);

      let bposcenter = [...bpos];
      bposcenter[0] += b.first_child.size.width / 2;
      bposcenter[1] += b.first_child.size.height / 2;
      let dst = this._get_distance(pointer, bposcenter);

      if (nearestDistance == -1 || nearestDistance > dst) {
        nearestDistance = dst;
        nearestIcon = b;
        nearestIdx = idx;
      }

      bpos[0] -= pos[0];
      bpos[1] -= pos[1];

      b._animIconContainer._target = bpos;
      b._animIconContainer._targetScale = 1;

      // hide existing icon
      b._icon = b.first_child;
      b._icon.hide();
      b.size = b._icon.size;

      b._animIconContainer.size = b._icon.size;

      idx++;
    });

    if (nearestIcon && nearestDistance < 90) {
      let pos = nearestIcon._animIconContainer._target;
      let current_scale = nearestIcon._animIconContainer.get_scale()[0];

      let py = 20;

      let _ix = 1;
      let _iy = 0;
      let _inv = 1;

      // scale & position target icon
      if (dockPosition === 'bottom') {
        pos[1] -= py;
        _ix = 0;
        _iy = 1;
      } else if (dockPosition === 'left') {
        pos[0] += py;
        _inv = -1;
      } else {
        pos[0] -= py;
      }

      nearestIcon._animIconContainer._target = pos;
      nearestIcon._animIconContainer._targetScale = MAX_SCALE;

      let labelX = this._get_x(nearestIcon._animIconContainer);
      let labelY = this._get_y(nearestIcon._animIconContainer);

      if (dockPosition === 'bottom') {
        labelY =
          labelY -
          nearestIcon._animIconContainer.size.height * MAX_SCALE * 0.75;
      } else {
        if (dockPosition === 'left') {
          labelX =
            labelX +
            nearestIcon._animIconContainer.size.width * MAX_SCALE * 0.75;
        } else {
          labelX =
            labelX -
            nearestIcon._animIconContainer.size.width * MAX_SCALE * 0.75;
        }
      }
      if (!isNaN(labelX) && !isNaN(labelY)) {
        nearestIcon._label.x = labelX;
        nearestIcon._label.y = labelY;
      }

      // scale & position other icons
      let offset = 10;
      let sz = current_scale;
      for (let idx = 1; idx < 100; idx++) {
        let left = nearestIdx - idx;
        let right = nearestIdx + idx;
        sz *= 0.6;
        if (sz < 1) sz = 1;

        py *= 0.6;

        if (left >= 0) {
          let pos = this.icons[left]._animIconContainer._target;
          pos[_ix] -= offset;
          pos[_iy] -= py * _inv;
          this.icons[left]._animIconContainer._target = pos;
          this.icons[left]._animIconContainer._targetScale = sz;
        } else {
          left = -1;
        }
        if (right < this.icons.length) {
          let pos = this.icons[right]._animIconContainer._target;
          pos[_ix] += offset;
          pos[_iy] -= py * _inv;
          this.icons[right]._animIconContainer._target = pos;
          this.icons[right]._animIconContainer._targetScale = sz;
        } else {
          right = -1;
        }
        if (left == -1 && right == -1) break;
        offset *= 0.9;
      }
    }

    // animate!
    let coef = 3;
    idx = 0;
    this.icons.forEach((b) => {
      let _idx = nearestIdx - idx;
      let pos = b._animIconContainer.get_position();
      let scale = b._animIconContainer._targetScale;

      let dst = this._get_distance(pos, b._animIconContainer._target);
      if (dst > 20) {
        pos = b._animIconContainer._target;
      } else {
        pos[0] = (pos[0] * coef + b._animIconContainer._target[0]) / (coef + 1);
        pos[1] = (pos[1] * coef + b._animIconContainer._target[1]) / (coef + 1);
      }

      let current_scale = b._animIconContainer.get_scale()[0];
      scale = (current_scale * coef + scale) / (coef + 1);

      b._animIconContainer.set_position(pos[0], pos[1]);
      b._animIconContainer.set_scale(scale, scale);
      idx++;
    });
  }

  _beginAnimation() {
    if (this._timeoutId) {
      clearInterval(this._timeoutId);
      this._timeoutId = null;
    }
    if (this._intervalId == null) {
      this._intervalId = setInterval(this._animate.bind(this), 50);
    }

    // this.animationContainer.add_style_class_name('hi');
  }

  _endAnimation() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._timeoutId = null;

    this.animationContainer.remove_style_class_name('hi');
  }

  _debounceEndAnimation() {
    if (this._timeoutId) {
      clearInterval(this._timeoutId);
    }
    this._timeoutId = setTimeout(this._endAnimation.bind(this), 1500);
  }

  _onAutoHideSpyEvent() {
    if (!this.dashContainer) return;
    let pos1 = this.dashContainer.get_position();
    let pos2 = this.animationContainer.get_position();
    if (
      pos1[0] != pos2[0] ||
      pos1[1] - this.dashContainer.size.height != pos2[1]
    ) {
      this._onEnterEvent();
    }
  }

  _queryPosition() {
    if (!this.dashContainer) return '?';
    let pos = this.dashContainer.get_position();
    let primaryMonitorNumber = global.display.get_primary_monitor();
    let box = global.display.get_monitor_geometry(primaryMonitorNumber);

    if (pos[0] < box.width / 2) {
      this._position = 'left';
    } else {
      this._position = 'right';
    }
    if (pos[1] > box.height / 2) {
      this._position = 'bottom';
    }
    return this._position;
  }

  _get_x(obj) {
    if (obj == null) return 0;
    return obj.get_transformed_position()[0];
  }

  _get_y(obj) {
    if (obj == null) return 0;
    return obj.get_transformed_position()[1];
  }

  _get_position(obj) {
    return [this._get_x(obj), this._get_y(obj)];
  }

  _get_distance_sqr(pos1, pos2) {
    let a = pos1[0] - pos2[0];
    let b = pos1[1] - pos2[1];
    return a * a + b * b;
  }

  _get_distance(pos1, pos2) {
    return Math.sqrt(this._get_distance_sqr(pos1, pos2));
  }
}

function init() {
  return new Extension();
}