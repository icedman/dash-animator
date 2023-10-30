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

const Point = Graphene.Point;

const ANIM_ICON_QUALITY = 2.0;
const ANIM_INTERVAL = 15;
const ANIM_INTERVAL_PAD = 15;

export default class DashAnimatorExt extends Extension {
  enable() {
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

    this._loTimer.runOnce(() => {
      this._hiTimer.runLoop(() => {
        this._hookDocks();
      }, 500);
    }, 750);

    this.icon_size = 0;
    this.icon_quality = ANIM_ICON_QUALITY;
    this.animation_fps = 2;
    this.animation_rise = 0.5;
    this.animation_spread = 0.2;
    this.animation_magnify = 0.5;
    this._vertical = false;
    this._dash_opacity = 0;

    this._updateAnimationFPS();
  }

  disable() {
    this._timer?.shutdown();
    this._timer = null;
    this._hiTimer?.shutdown();
    this._hiTimer = null;
    this._loTimer?.shutdown();
    this._loTimer = null;

    this._releaseDocks();
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
}
