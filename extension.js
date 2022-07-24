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

const ANIMATION_INTERVAL = 25;
const ANIMATION_POS_COEF = 2;
const ANIMATION_PULL_COEF = 1.8;
const ANIMATION_SCALE_COEF = 2.5;
const ANIM_ICON_RAISE = 0.15;
const ANIM_ICON_SCALE = 2.0;

class Extension {
  constructor() {}

  enable() {
    this._iconsContainer = new St.Widget({ name: 'iconsContainer' });
    Main.uiGroup.add_child(this._iconsContainer);
    this._iconsContainer.hide();

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

    log('enable animator');
  }

  disable() {
    this._endAnimation();

    if (this._intervals) {
      this._intervals.forEach((id) => {
        clearInterval(id);
      });
      this._intervals = [];
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

    if (this.dashContainer) {
      this._restoreIcons();

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

    log('disable animator');
  }

  _findDashContainer() {
    if (this.dashContainer) {
      return false;
    }

    this.dashContainer = Main.uiGroup.find_child_by_name('dashtodockContainer');
    if (!this.dashContainer) {
      return false;
    }

    // log('dashtodockContainer found!');

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
        this.dashContainer = null;
        let icons = this._iconsContainer.get_children();
        icons.forEach((icon) => {
          this._iconsContainer.remove_child(icon);
        });
        setTimeout(this._startAnimation.bind(this), 1500);
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
    if (!this.dashContainer || !this.dash) return [];

    let icons = [];

    let children = this.dash.last_child.first_child.last_child.get_children();
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
      icons.push(bin);
    });

    // apps button
    // determine panel mode first
    if (false) {
      let apps = this.dash.last_child.last_child;
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

    this.dashContainer._icons = icons;
    return icons;
  }

  _updateIcons() {
    if (!this._iconsContainer) return;

    let existingIcons = this._iconsContainer.get_children();

    if (!this._iconsContainer.visible) {
      // daskToDock code...
      if (this.dashContainer._dockState > 0) {
        this._iconsContainer.show();
      }
      return;
    }

    let dock_position = 'bottom';
    let ix = 0;
    let iy = 1;

    let pivot = new Point();
    pivot.x = 0.5;
    pivot.y = 1.0;

    switch (this.dashContainer._position) {
      case 1:
        dock_position = 'right';
        ix = 1;
        iy = 0;
        pivot.x = 1.0;
        pivot.y = 0.5;
        break;
      case 2:
        dock_position = 'bottom';
        break;
      case 3:
        dock_position = 'left';
        ix = 1;
        iy = 0;
        pivot.x = 0.0;
        pivot.y = 0.5;
        break;
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
      uiIcon.pivot_point = pivot;

      uiIcon._bin = bin;
      this._iconsContainer.add_child(uiIcon);

      // spy dragging events
      let draggable = bin._draggable;
      if (draggable && !bin._dragBeginId) {
        bin._dragBeginId = draggable.connect('drag-begin', () => {
          this._dragging = true;
          this._restoreIcons();
          this.disable();
        });
        bin._dragEndId = draggable.connect('drag-end', () => {
          this._dragging = false;
          this.disable();
          this.enable();
        });
      }
    });

    let pointer = global.get_pointer();

    let nearestIdx = -1;
    let nearestIcon = null;
    let nearestDistance = -1;
    let iconSize = 32;

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
    });

    animateIcons = [...this._iconsContainer.get_children()];

    // sort
    let cornerPos = this._get_position(this.dashContainer);
    animateIcons.sort((a, b) => {
      let dstA = this._get_distance(cornerPos, this._get_position(a));
      let dstB = this._get_distance(cornerPos, this._get_position(b));
      return dstA > dstB ? 1 : -1;
    });

    let idx = 0;
    animateIcons.forEach((icon) => {
      let bin = icon._bin;
      let pos = this._get_position(bin);

      iconSize = this.dash.iconSize;
      bin.set_size(iconSize, iconSize);
      icon.set_size(iconSize, iconSize);

      // get nearest
      let bposcenter = [...pos];
      bposcenter[0] += bin.first_child.size.width / 2;
      bposcenter[1] += bin.first_child.size.height / 2;
      let dst = this._get_distance(pointer, bposcenter);

      if (
        (nearestDistance == -1 || nearestDistance > dst) &&
        dst < iconSize * 0.8
      ) {
        nearestDistance = dst;
        nearestIcon = icon;
        nearestIdx = idx;
        icon._distance = dst;
        icon._dx = bposcenter[0] - pointer[0];
        icon._dy = bposcenter[1] - pointer[1];
      }

      // if (bin._apps) {
      //   bin.first_child.add_style_class_name('invisible');
      // } else {
      //   bin.first_child.hide();
      // }

      bin.opacity = 0;

      icon._target = pos;
      icon._targetScale = 1;

      idx++;
    });

    // set animation behavior here
    if (nearestIcon && nearestDistance < iconSize * 2) {
      nearestIcon._target[iy] -= iconSize * ANIM_ICON_RAISE;
      nearestIcon._targetScale = ANIM_ICON_SCALE;

      let offset = nearestIcon._dx / 4;
      let offsetY = (offset < 0 ? -offset : offset) / 2;
      nearestIcon._target[ix] += offset;
      nearestIcon._target[iy] += offsetY;

      let prevLeft = nearestIcon;
      let prevRight = nearestIcon;
      let sz = nearestIcon._targetScale;
      let pull_coef = ANIMATION_PULL_COEF;

      for (let i = 1; i < 80; i++) {
        sz *= 0.8;

        let left = null;
        let right = null;
        if (nearestIdx - i >= 0) {
          left = animateIcons[nearestIdx - i];
          left._target[ix] =
            (left._target[ix] + prevLeft._target[ix] * pull_coef) /
            (pull_coef + 1);
          left._target[ix] -= iconSize * (sz + 0.2);
          if (sz > 1) {
            left._targetScale = sz;
          }
          prevLeft = left;
        }
        if (nearestIdx + i < animateIcons.length) {
          right = animateIcons[nearestIdx + i];
          right._target[ix] =
            (right._target[ix] + prevRight._target[ix] * pull_coef) /
            (pull_coef + 1);
          right._target[ix] += iconSize * (sz + 0.2);
          if (sz > 1) {
            right._targetScale = sz;
          }
          prevRight = right;
        }

        if (!left && !right) break;

        pull_coef *= 0.9;
      }
    }

    let didAnimate = false;

    // animate to target scale and position
    animateIcons.forEach((icon) => {
      let pos = icon._target;
      let scale = icon._targetScale;
      let fromScale = icon.get_scale()[0];

      icon.set_scale(1, 1);
      let from = this._get_position(icon);
      let dst = this._get_distance(from, icon._target);

      scale =
        (fromScale * ANIMATION_SCALE_COEF + scale) / (ANIMATION_SCALE_COEF + 1);

      if (dst > iconSize * 0.01 && dst < iconSize * 3) {
        pos[0] =
          (from[0] * ANIMATION_POS_COEF + pos[0]) / (ANIMATION_POS_COEF + 1);
        pos[1] =
          (from[1] * ANIMATION_POS_COEF + pos[1]) / (ANIMATION_POS_COEF + 1);
        didAnimate = true;
      }

      if (!isNaN(scale)) {
        icon.set_scale(scale, scale);
      }

      if (!isNaN(pos[0]) && !isNaN(pos[1])) {
        // why does NaN happen?
        icon.set_position(pos[0], pos[1]);

        switch (dock_position) {
          case 'left':
            icon._bin._label.x = pos[0] + iconSize * scale * 1.1;
            break;
          case 'right':
            icon._bin._label.x = pos[0] - iconSize * scale * 1.1;
            icon._bin._label.x -= icon._bin._label.width / 1.8;
            break;
          case 'bottom':
            icon._bin._label.y = pos[1] - iconSize * scale * 1.1;
            break;
        }
      }
    });

    if (didAnimate) {
      this._debounceEndAnimation();
    }
  }

  _restoreIcons() {
    let icons = this._findIcons();
    icons.forEach((bin) => {
      bin.opacity = 255;
      if (!this._dragging) {
        if (bin._dragBeginId) {
          bin._draggable.disconnect(bin._dragBeginId);
        }
        if (bin._dragEndId) {
          bin._draggable.disconnect(bin._dragEndId);
        }
        bin._draggable = null;
        bin._dragBeginId = null;
        bin._dragEndId = null;
      }
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

  _get_distance_sqr(pos1, pos2) {
    let a = pos1[0] - pos2[0];
    let b = pos1[1] - pos2[1];
    return a * a + b * b;
  }

  _get_distance(pos1, pos2) {
    return Math.sqrt(this._get_distance_sqr(pos1, pos2));
  }

  _beginAnimation() {
    if (this._timeoutId) {
      clearInterval(this._timeoutId);
      this._timeoutId = null;
    }
    if (this._intervalId == null) {
      this._intervalId = setInterval(
        this._animate.bind(this),
        ANIMATION_INTERVAL
      );
    }

    if (this.dashContainer) {
      // this.dashContainer.add_style_class_name('hi');
    }
  }

  _endAnimation() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._timeoutId = null;

    if (this.dashContainer) {
      this.dashContainer.remove_style_class_name('hi');
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

  _onFocusWindow() {
    this._startAnimation();
  }

  _onFullScreen() {
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
