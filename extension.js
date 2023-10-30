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

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Graphene from 'gi://Graphene';
import GObject from 'gi://GObject';
import St from 'gi://St';

import { Animator } from './animator.js';
import { Timer } from './timer.js';

import {
  Extension,
  gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';

import { schemaId, SettingsKeys } from './preferences/keys.js';

const Point = Graphene.Point;

const ANIM_ICON_QUALITY = 2.0;
const ANIM_INTERVAL = 15;
const ANIM_INTERVAL_PAD = 15;

export default class DashAnimatorExt extends Extension {
  enable() {
    this._enableSettings();

    // three available timers
    // for persistent runs
    this._timer = new Timer('loop timer');
    this._timer.initialize(3500);

    // for animation runs
    // resolution (15) will be modified by animation-fps
    this._hiTimer = new Timer('hi-res timer');
    this._hiTimer.initialize(15);

    // for deferred or debounced runs
    this._loTimer = new Timer('lo-res timer');
    this._loTimer.initialize(750);

    this._updateAnimationFPS();
    this._updateIconResolution();

    this._loTimer.runOnce(() => {
      this._hiTimer.runLoop(() => {
        this._hookDocks();
      }, 250);
    }, 250);
  }

  disable() {
    this._timer?.shutdown();
    this._timer = null;
    this._hiTimer?.shutdown();
    this._hiTimer = null;
    this._loTimer?.shutdown();
    this._loTimer = null;

    this._releaseDocks();

    this._disableSettings();
  }

  _findDocks() {
    let res = [];
    let cc = Main.uiGroup.get_children();
    cc.forEach((c) => {
      if (c.name && c.name.startsWith('dashtodock')) {
        res.push(c);
      }
    });
    return res;
  }

  _hookDocks() {
    let docks = this._findDocks();
    docks.forEach((d) => {
      if (!d.animator) {
        let animator = new Animator();
        animator.extension = this;
        animator.hook(d);
      }
    });
  }

  _releaseDocks() {
    let docks = this._findDocks();
    docks.forEach((d) => {
      if (d.animator) {
        d.animator.release(d);
      }
    });
  }

  _updateAnimationFPS() {
    this.animationInterval =
      ANIM_INTERVAL + (this.animation_fps || 0) * ANIM_INTERVAL_PAD;
    this._hiTimer.shutdown();
    this._hiTimer.initialize(this.animationInterval);
  }

  _updateIconResolution() {
    this.icon_quality = 1 + [2, 0, 1, 2, 3][this.icon_resolution || 0];
  }

  _enableSettings() {
    // default
    this.icon_quality = ANIM_ICON_QUALITY;
    this.animation_fps = 2;
    this.animation_rise = 0.5;
    this.animation_spread = 0.2;
    this.animation_magnify = 0.5;
    this.icon_effect = 2;
    this.icon_effect_color = [1, 0.5, 0.5, 0.5];
    this._dash_opacity = 0;

    this._settings = this.getSettings(schemaId);
    this._settingsKeys = SettingsKeys();

    this._settingsKeys.connectSettings(this._settings, (name, value) => {
      let n = name.replace(/-/g, '_');
      this[n] = value;

      // log(`${n} ${value}`);

      switch (name) {
        case 'animation-fps': {
          this._updateAnimationFPS();
          break;
        }
        case 'animation-magnify':
        case 'animation-spread':
        case 'animation-rise': {
          // preview mode
          break;
        }
        case 'calendar-icon':
        case 'clock-icon': {
          // redraw
          break;
        }
        // problematic settings needing animator restart
        case 'icon-resolution': {
          this._updateIconResolution();
          let docks = this._findDocks();
          docks.forEach((d) => {
            if (d.animator) {
              d.animator._iconsContainer.clear();
            }
          });
          bre;
          break;
        }
        case 'icon-effect':
        case 'icon-effect-color': {
          let docks = this._findDocks();
          docks.forEach((d) => {
            if (d.animator) {
              d.animator._updateIconEffect();
            }
          });
          break;
        }
      }
    });

    Object.keys(this._settingsKeys._keys).forEach((k) => {
      let key = this._settingsKeys.getKey(k);
      let name = k.replace(/-/g, '_');
      this[name] = key.value;
      if (key.options) {
        this[`${name}_options`] = key.options;
      }
    });
  }

  _disableSettings() {
    this._settingsKeys.disconnectSettings();
    this._settingsKeys = null;
  }
}
