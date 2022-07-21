/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */

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

const setTimeout = Me.imports.utils.setTimeout;
const setInterval = Me.imports.utils.setInterval;
const clearInterval = Me.imports.utils.clearInterval;
const clearTimeout = Me.imports.utils.clearTimeout;

class Extension {
  constructor() {}

  enable() {
    log('enable watch');

    this._iconsContainer = new St.Widget({ name: 'icons_container' });
    this._iconsContainer.hide();
    Main.uiGroup.add_child(this._iconsContainer);

    this._overViewEvents = [];
    this._overViewEvents.push(
      Main.overview.connect('showing', () => {
        log('showing');
      })
    );
    this._overViewEvents.push(
      Main.overview.connect('hidden', () => {
        log('hidden');
      })
    );

    this._layoutManagerEvents = [];

    if (!this._findDashContainer()) {
      this._layoutManagerEvents.push(
        Main.layoutManager.connect('startup-complete', () => {
          log('startup-complete');
          this._findDashContainer();
        })
      );
    }

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

  disable() {
    log('disable watch');

    this._endAnimation();

    if (this._intervals) {
      this._intervals.forEach((id) => {
        clearInterval(id);
      });
      this._intervals = [];
    }

    if (this.dashContainer) {
      this._restoreIcons();

      // unhook
      this.dashContainer._animateIn = this.dashContainer.__animateIn;
      this.dashContainer._animateOut = this.dashContainer.__animateOut;
      this.dashContainer.set_reactive(false);
      this.dashContainer.set_track_hover(false);
      this.dashContainerEvents.forEach((id) => {
        if (this.dashContainer) {
          this.dashContainer.disconnect(id);
        }
      });
      this.dashContainerEvents = [];
      this.dashContainer = null;
    }

    if (this._overViewEvents) {
      this._overViewEvents.forEach((id) => {
        Main.overview.disconnect(id);
      });
    }
    this._overViewEvents = [];

    if (this._layoutManagerEvents) {
      this._layoutManagerEvents.forEach((id) => {
        Main.layoutManager.disconnect(id);
      });
    }
    this._layoutManagerEvents = [];

    if (this._iconsContainer) {
      Main.uiGroup.remove_child(this._iconsContainer);
      delete this._iconsContainer;
      this._iconsContainer = null;
    }
  }

  _findDashContainer() {
    if (this.dashContainer) {
      return false;
    }

    this.dashContainer = Main.uiGroup.find_child_by_name('dashtodockContainer');
    if (!this.dashContainer) {
      return false;
    }

    log('dashContainer found!');

    this.dashContainer.set_reactive(true);
    this.dashContainer.set_track_hover(true);

    this.dashContainerEvents = [];
    this.dashContainerEvents.push(
      this.dashContainer.connect('motion-event', this._onMotionEvent.bind(this))
    );
    this.dashContainerEvents.push(
      this.dashContainer.connect('enter-event', this._onEnterEvent.bind(this))
    );
    this.dashContainerEvents.push(
      this.dashContainer.connect('leave-event', this._onLeaveEvent.bind(this))
    );
    this.dashContainerEvents.push(
      this.dashContainer.connect('destroy', () => {
        this.dashContainer = null;
        this.disable();
        setTimeout(this.enable.bind(this), 500);
      })
    );

    // hooks
    this.dashContainer.__animateIn = this.dashContainer._animateIn;
    this.dashContainer.__animateOut = this.dashContainer._animateOut;

    this.dashContainer._animateIn = (time, delay) => {
      this._startAnimation();
      this.dashContainer.__animateIn(time, delay);
    };
    this.dashContainer._animateOut = (time, delay) => {
      this._startAnimation();
      this.dashContainer.__animateOut(time, delay);
    };

    this._animate();
    return true;
  }

  _animate() {
    if (!this.dashContainer) {
      this._findDashContainer();
    }
    if (!this.dashContainer) return;

    this._updateIcons();
  }

  _findIcons() {
    if (!this.dashContainer) return;
    let dash = this.dashContainer.find_child_by_name('dash');
    if (!dash) return [];

    let icons = [];

    let children = dash.last_child.first_child.last_child.get_children();
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

      icons.push(bin);
    });

    // apps button
    if (true) {
      let apps = dash.last_child.last_child;
      let label = apps.label;
      let button = apps.first_child;
      let icongrid = button.first_child;
      let boxlayout = icongrid.first_child;
      let bin = boxlayout.first_child;
      let icon = bin.first_child;
      bin._label = label;

      bin._apps = true;
      icons.push(bin);
    }

    return icons;
  }

  _updateIcons() {
    let containerPos = this._get_position(this._iconsContainer);
    let existingIcons = this._iconsContainer.get_children();

    if (!this._iconsContainer.visible) {
      if (this.dashContainer._dockState > 0) {
        this._iconsContainer.show();
      }
      return;
    }

    let icons = this._findIcons();
    icons.forEach((bin) => {
      for (let i = 0; i < existingIcons.length; i++) {
        if (existingIcons[i]._bin == bin) {
          return;
        }
      }

      let icon = bin.first_child;

      let uiIcon = new St.Icon({ name: 'some_icon' });
      uiIcon.icon_name = icon.icon_name;
      if (!uiIcon.icon_name) {
        uiIcon.gicon = icon.gicon;
      }

      uiIcon._bin = bin;
      this._iconsContainer.add_child(uiIcon);
    });

    let animateIcons = this._iconsContainer.get_children();
    animateIcons.forEach((icon) => {
      let orphan = true;
      for (let i = 0; i < icons.length; i++) {
        if (icons[i] == icon._bin) {
          orphan = false;
          break;
        }
      }

      if (orphan) {
        this._iconsContainer.remove_child(icon);
        return;
      }

      let pos = this._get_position(icon._bin);
      pos[1] -= 10;

      // pos[0] -= containerPos[0];
      // pos[1] -= containerPos[1];

      let size = icon._bin.first_child.get_size();
      icon._bin.set_size(size[0], size[1]);
      if (icon._bin._apps) {
        icon._bin.first_child.add_style_class_name('invisible');
      } else {
        icon._bin.first_child.hide();
      }

      if (!isNaN(pos[0]) && !isNaN(pos[1])) {
        // why does NaN happen?
        icon.set_position(pos[0], pos[1]);
      }
    });

  }

  _restoreIcons() {
    let icons = this._findIcons();
    icons.forEach((bin) => {
      bin.first_child.show();
      bin.first_child.remove_style_class_name('invisible');
    });
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

  _beginAnimation() {
    if (this._timeoutId) {
      clearInterval(this._timeoutId);
      this._timeoutId = null;
    }
    if (this._intervalId == null) {
      this._intervalId = setInterval(this._animate.bind(this), 50);
    }

    // if (this._iconsContainer) {
    //   this._iconsContainer.add_style_class_name('hi');
    // }
  }

  _endAnimation() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._timeoutId = null;
    if (this._iconsContainer) {
      this._iconsContainer.remove_style_class_name('hi');
    }
  }

  _debounceEndAnimation() {
    if (this._timeoutId) {
      clearInterval(this._timeoutId);
    }
    this._timeoutId = setTimeout(this._endAnimation.bind(this), 1500);
  }

  _onMotionEvent() {
    this._onEnterEvent();
  }

  _onEnterEvent() {
    this._inDash = true;
    this._startAnimation();
  }

  _onLeaveEvent() {
    this._inDash = false;
    this._debounceEndAnimation();
  }

  // on drag.. on resize
  _onFocusWindow() {
    this._startAnimation();
  }

  _onFullScreen() {
    log('_onFullScreen');
    if (!this.dashContainer || !this._iconsContainer) return;
    let primary = Main.layoutManager.primaryMonitor;
    if (!primary.inFullscreen) {
      this._iconsContainer.show();
    } else {
      this._iconsContainer.hide();
    }
  }

  _startAnimation() {
    this._beginAnimation();
    this._debounceEndAnimation();
  }
}

function init() {
  return new Extension();
}
