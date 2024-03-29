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

const Animator = Me.imports.animator.Animator;

const setTimeout = Me.imports.utils.setTimeout;
const setInterval = Me.imports.utils.setInterval;
const clearInterval = Me.imports.utils.clearInterval;
const clearTimeout = Me.imports.utils.clearTimeout;

class Extension {
  constructor() {}

  enable() {
    this.animator = new Animator();
    this.animator.extension = this;

    this.services = {
      updateIcon: (icon) => {
        if (icon && icon.icon_name && icon.icon_name.startsWith('user-trash')) {
          if (
            icon._source &&
            icon._source.first_child &&
            icon.icon_name != icon._source.first_child.icon_name
          ) {
            icon.icon_name = icon._source.first_child.icon_name;
          }
        }
      },
    };

    // animator setting
    this.animation_fps = 0;
    this.animation_magnify = 0.5;
    this.animation_spread = 0.6;
    this.animation_rise = 0.2;

    this.enabled = true;
    this._dragging = false;
    this._oneShotId = null;

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

    this.animator.enable();
  }

  disable() {
    this.enabled = false;
    this.animator.disable();

    if (this._findDashIntervalId) {
      clearInterval(this._findDashIntervalId);
      this._findDashIntervalId = null;
    }

    if (this._intervals) {
      this._intervals.forEach((id) => {
        clearInterval(id);
      });
      this._intervals = [];
    }
    if (this._oneShotId) {
      clearInterval(this._oneShotId);
      this._oneShotId = null;
    }

    if (this.dashContainer) {
      // unhook
      this.dashContainer._animateIn = this.dashContainer.__animateIn;
      this.dashContainer._animateOut = this.dashContainer.__animateOut;
      this.dashContainer.set_reactive(false);
      this.dashContainer.set_track_hover(false);
      this.dashContainerEvents.forEach((id) => {
        if (this.dashContainer) {
          // needed?
          this.dashContainer.disconnect(id);
        }
      });
      this.dashContainerEvents = [];
      this.dashContainer = null;
    }

    if (this._iconsContainer) {
      Main.uiGroup.remove_child(this._iconsContainer);
      delete this._iconsContainer;
      this._iconsContainer = null;
    }

    if (this.dash) {
      this.dashEvents.forEach((id) => {
        if (this.dash) {
          this.dash.disconnect(id);
        }
      });
      this.dashEvents = [];
      this.dash = null;
    }

    if (this._layoutManagerEvents) {
      this._layoutManagerEvents.forEach((id) => {
        Main.layoutManager.disconnect(id);
      });
    }
    this._layoutManagerEvents = [];

    // log('disable animator');

    this.animator = null;
  }

  _findDashContainer() {
    log('searching for dash container');

    if (this.dashContainer) {
      return false;
    }

    this.dashContainer = Main.uiGroup.find_child_by_name('dashtodockContainer');
    if (!this.dashContainer) {
      return false;
    }

    if (this._findDashIntervalId) {
      clearInterval(this._findDashIntervalId);
      this._findDashIntervalId = null;
    }

    this.scale = 1;
    this.dashContainer.delegate = this;
    this.animator.dashContainer = this.dashContainer;

    log('dashtodockContainer found!');

    this.dash = this.dashContainer.find_child_by_name('dash');
    this.dashEvents = [];
    this.dashEvents.push(
      this.dash.connect('icon-size-changed', this._startAnimation.bind(this))
    );

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
        this.animator.disable();
        this.animator.enable();
        this.dashContainer = null;
        this._findDashIntervalId = setInterval(
          this._findDashContainer.bind(this),
          500
        );
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

    this.animator._animate();
    return true;
  }

  _findIcons() {
    if (!this.dash || !this.dashContainer) return [];

    // hook on showApps
    if (this.dash.showAppsButton && !this.dash.showAppsButton._checkEventId) {
      this.dash.showAppsButton._checkEventId = this.dash.showAppsButton.connect(
        'notify::checked',
        () => {
          if (!Main.overview.visible) {
            Main.uiGroup
              .find_child_by_name('overview')
              ._controls._toggleAppsPage();
          }
        }
      );
    }

    let icons = this.dash._box.get_children().filter((actor) => {
      if (actor.child && actor.child._delegate && actor.child._delegate.icon) {
        return true;
      }
      return false;
    });

    icons.forEach((c) => {
      let label = c.label;
      let appwell = c.first_child;
      let draggable = appwell._draggable;
      let widget = appwell.first_child;
      let icongrid = widget.first_child;
      let boxlayout = icongrid.first_child;
      let bin = boxlayout.first_child;
      if (!bin) return; // ??
      let icon = bin.first_child;

      c._bin = bin;
      c._label = label;
      c._draggable = draggable;
      c._appwell = appwell;
      if (icon) {
        c._icon = icon;
      }
    });

    try {
      // this.dash._showAppsIcon;
      let apps = Main.overview.dash.last_child.last_child;
      if (apps) {
        let widget = apps.child;
        // account for JustPerfection & dash-to-dock hiding the app button
        if (widget && widget.width > 0 && widget.get_parent().visible) {
          let icongrid = widget.first_child;
          let boxlayout = icongrid.first_child;
          let bin = boxlayout.first_child;
          let icon = bin.first_child;
          let c = {};
          c.child = widget;
          c._bin = bin;
          c._icon = icon;
          c._label = widget._delegate.label;
          icons.push(c);
        }
      }
    } catch (err) {
      // could happen if ShowApps is hidden
    }

    this.dashContainer._icons = icons;
    return icons;
  }

  _beginAnimation() {
    if (this.animator)
    this.animator._beginAnimation();
  }

  _endAnimation() {
    if (this.animator)
    this.animator._endAnimation();
  }

  _debounceEndAnimation() {
    if (this.animator)
    this.animator._debounceEndAnimation();
  }

  _onMotionEvent() {
    if (this.animator)
    this.animator._onMotionEvent();
  }

  _onEnterEvent() {
    if (this.animator)
    this.animator._onEnterEvent();
  }

  _onLeaveEvent() {
    if (this.animator)
    this.animator._onLeaveEvent();
  }

  _onFocusWindow() {
    if (this.animator)
    this.animator._onFocusWindow();
  }

  _onFullScreen() {
    if (this.animator)
    this.animator._onFullScreen();
  }

  _startAnimation() {
    if (this.animator)
    this.animator._startAnimation();
  }
}

function init() {
  return new Extension();
}
