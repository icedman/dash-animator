import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Graphene from 'gi://Graphene';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

const Point = Graphene.Point;

import { IconsContainer } from './dockItems.js';
import { Timer } from './timer.js';

import { TintEffect } from './effects/tint_effect.js';
import { MonochromeEffect } from './effects/monochrome_effect.js';
import { Animation } from './effects/maclike_animation.js';

const ANIM_POS_COEF = 1.5;
const ANIM_SCALE_COEF = 1.5 * 2;
const ANIM_SPREAD_COEF = 1.25 * 1;
const ANIM_ON_LEAVE_COEF = 2.0;
const ANIM_ICON_RAISE = 0.6;
const ANIM_ICON_SCALE = 1.5;
const ANIM_ICON_HIT_AREA = 2.5;
const ANIM_REENABLE_DELAY = 250;
const ANIM_DEBOUNCE_END_DELAY = 750;
const ANIM_PREVIEW_DURATION = 1200;

const FIND_ICONS_SKIP_FRAMES = 16;
const THROTTLE_DOWN_FRAMES = 30;
const THROTTLE_DOWN_DELAY_FRAMES = 20;

const MIN_SCROLL_RESOLUTION = 4;
const MAX_SCROLL_RESOLUTION = 10;

export let Animator = GObject.registerClass(
  {},
  class Animator extends St.Widget {
    _init(params) {
      super._init({
        name: 'd2dlAnimator',
        reactive: true,
        track_hover: true,
        ...(params || {}),
      });

      this._throttleDown = 0;
      this._previousFindIndex = 0;
    }

    hook(dashContainer) {
      this.dashContainer = dashContainer;
      this.dash = dashContainer.dash;
      dashContainer.animator = this;
      Main.uiGroup.insert_child_below(this, dashContainer);

      this._hiTimer = this.extension._hiTimer;
      this._beginAnimation();

      this._iconsContainer = new IconsContainer({
        name: 'd2dlIconsContainer',
        offscreen_redirect: Clutter.OffscreenRedirect.ALWAYS,
        reactive: false,
      });

      Main.uiGroup.insert_child_above(this._iconsContainer, dashContainer);

      this._updateIconEffect();

      this.dashContainer.reactive = true;
      this.dashContainer.track_hover = true;
      this.dashContainer.connectObject(
        'motion-event',
        this._onMotionEvent.bind(this),
        'enter-event',
        this._onEnterEvent.bind(this),
        'leave-event',
        this._onLeaveEvent.bind(this),
        'destroy',
        () => {
          this.release(dashContainer);
        },
        this
      );

      this._updateSeq = this._hiTimer.runLoop(() => {
        this._update();
      }, 750);
    }

    release(dashContainer) {
      this.extension._hiTimer.cancel(this._updateSeq);
      
      Main.uiGroup.remove_child(this);

      dashContainer.animator = null;
      Main.uiGroup.remove_child(this._iconsContainer);

      this.dashContainer.reactive = false;
      this.dashContainer.track_hover = false;
      this.dashContainer.disconnectObject(this);
      this.dashContainer = null;
      this.dash = null;
    }

    _findIcons() {
      if (!this.dash) return [];

      this._separators = [];

      // W: breakable
      let icons = this.dash._box.get_children().filter((actor) => {
        if (!actor.child) {
          let cls = actor.get_style_class_name();
          if (cls === 'dash-separator') {
            actor.visible = false;
            // actor.width = (this.iconSize / 8) * (this.scaleFactor || 1);
            // actor.height = (this.iconSize / 8) * (this.scaleFactor || 1);
            this._separators.push(actor);
          }
          return false;
        }

        actor._cls = actor.get_style_class_name();

        if (actor.child._delegate && actor.child._delegate.icon) {
          // hook activate function
          if (actor.child.activate && !actor.child._activate) {
            actor.child._activate = actor.child.activate;
            actor.child.activate = () => {
              // this._maybeBounce(actor);
              // this._maybeMinimizeOrMaximize(actor.child.app);
              actor.child._activate();
            };
          }

          return true;
        }
        return false;
      });

      icons.forEach((c) => {
        // W: breakable
        let label = c.label;
        let appwell = c.first_child;
        let draggable = appwell._draggable;
        let widget = appwell.first_child;
        let icongrid = widget.first_child;
        let boxlayout = icongrid.first_child;
        let bin = boxlayout.first_child;
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
        // W: breakable
        let appsButton = this.dash.showAppsButton;
        let appsIcon = this.dash._showAppsIcon;
        if (appsButton && appsIcon) {
          let apps = appsButton.get_parent();
          let widget = appsIcon.child;
          if (widget && widget.width > 0 && widget.get_parent().visible) {
            let icongrid = widget.first_child;
            let boxlayout = icongrid.first_child;
            let bin = boxlayout.first_child;
            let icon = bin.first_child;
            let c = apps;
            c._bin = bin;
            c._icon = icon;
            c._label = widget._delegate.label;
            c._showApps = appsButton;
            // make virtually unclickable
            // appsButton.reactive = false;
            // appsButton.width = 1;
            // appsButton.height = 1;
            icons.push(c);
          }
        }
      } catch (err) {
        // could happen if ShowApps is hidden or not yet created?
      }

      this._icons = icons;
      this._previousFind = icons;

      icons.forEach((icon) => {
        if (!icon._destroyConnectId) {
          icon._destroyConnectId = icon.connect('destroy', () => {
            this._previousFind = null;
          });
        }
      });

      return icons;
    }

    _update() {
      let shouldAnimate = false;
      let targets = [this];
      targets.forEach((t) => {
        let w = this.dashContainer.width;
        let h = this.dashContainer.height;
        t.x = this.dashContainer.x;
        t.y = this.dashContainer.y - h;
        if (t.width != w || t.height != h) {
          shouldAnimate = true;
        }
        t.width = w;
        t.height = h;
      });

      if (shouldAnimate) {
        this._beginAnimation();
      }
    }

    _animate() {
      if (!this._iconsContainer || !this.dashContainer) return;
      this.dash = this.dashContainer.dash;

      this.vertical = this.dashContainer.width < this.dashContainer.height;

      let icons = this._previousFind;

      // minimize findIcons call
      this._previousFindIndex++;
      if (!icons || this._dragging || this._previousFindIndex < 0) {
        icons = this._findIcons();
        this._previousFind = icons;
      } else {
        if (this._previousFindIndex > FIND_ICONS_SKIP_FRAMES) {
          this._previousFind = null;
          this._previousFindIndex = 0;
        }
      }

      // get monitor scaleFactor
      let monitor = Main.layoutManager.monitors[this.dash._monitorIndex];
      let scaleFactor = monitor.geometry_scale;
      let iconSize = Math.floor(icons[0]._icon.width + 8);

      let iconSpacing = iconSize * (1.2 + this.extension.animation_spread / 4);

      this._iconsContainer.x = monitor.x;
      this._iconsContainer.y = monitor.y;
      this._iconsContainer.width = monitor.width;
      this._iconsContainer.height = monitor.height;

      if (this._throttleDown) {
        this._throttleDown--;
        if (
          this._throttleDown > 0 &&
          this._throttleDown < THROTTLE_DOWN_FRAMES
        ) {
          return;
        }
      }

      let pointer = global.get_pointer();

      let pivot = new Point();
      pivot.x = 0.5;
      pivot.y = 1.0;

      let validPosition = this._iconsCount > 1;
      let dock_position = ['top', 'right', 'bottom', 'left'][
        this.dashContainer._position
      ];
      let ix = 0;
      let iy = 1;

      switch (dock_position) {
        case 'top':
          ix = 0;
          iy = -1.0;
          pivot.x = 0.0;
          pivot.y = 0.0;
          break;
        case 'right':
          ix = 1;
          iy = 0;
          pivot.x = 1.0;
          pivot.y = 0.5;
          break;
        case 'bottom':
          break;
        case 'left':
          ix = 1;
          iy = 0;
          pivot.x = 0.0;
          pivot.y = 0.5;
          break;
        default:
          // center
          break;
      }

      pivot.x *= scaleFactor;
      pivot.y *= scaleFactor;

      this._iconsContainer.update({
        icons,
        iconSize: iconSize * scaleFactor,
        pivot,
        quality: this.extension.icon_quality,
      });

      // icons.forEach((icon) => {
      // let { _draggable } = icon;
      // if (_draggable && !_draggable._dragBeginId) {
      //   _draggable._dragBeginId = _draggable.connect('drag-begin', () => {
      //     this._dragging = true;
      //   });
      //   _draggable._dragEndId = _draggable.connect('drag-end', () => {
      //     this._dragging = false;
      //     this._previousFindIndex = -FIND_ICONS_SKIP_FRAMES;
      //   });
      // }
      // });

      let nearestIdx = -1;
      let nearestIcon = null;
      let nearestDistance = -1;

      let animateIcons = this._iconsContainer.get_children();
      animateIcons = this._iconsContainer.get_children().filter((c) => {
        return c._bin && c._icon && c.visible;
      });

      let firstIcon = animateIcons[0];

      animateIcons.forEach((c) => {
        // if (this.extension.services) {
        //   this.extension.services.updateIcon(c._icon, { scaleFactor });
        // }
      });

      animateIcons.forEach((c) => {
        c._pos = this._get_position(c._bin);
      });

      // sort
      let cornerPos = this._get_position(this.dashContainer);
      animateIcons.sort((a, b) => {
        let dstA = this._get_distance(cornerPos, a._pos);
        let dstB = this._get_distance(cornerPos, b._pos);
        return dstA > dstB ? 1 : -1;
      });

      let idx = 0;
      animateIcons.forEach((icon) => {
        if (this.vertical) {
          icon._pos[0] = this.dashContainer.x;
          if (this.dashContainer._position == 'right') {
            icon._pos[0] += this.dashContainer.width / 2;
            icon._pos[0] -= (iconSize / 2) * scaleFactor;
          } else {
            icon._pos[0] += this.dashContainer.width / 2;
            icon._pos[0] -= (iconSize / 2) * scaleFactor;
          }
        } else {
          icon._pos[1] = this.dashContainer.y;
          icon._pos[1] += this.dashContainer.height / 2;
          icon._pos[1] -= (iconSize / 2) * scaleFactor;
        }

        let bin = icon._bin;
        let pos = [...icon._pos];

        icon._fixedPosition = [...pos];
        if (!this._dragging && bin.first_child) {
          bin.first_child.opacity = this.extension._dash_opacity;
          // todo make this small - so as not to mess up the layout
          // however, the icons appear when released from drag
          // bin.first_child.width = iconSize * 0.8 * scaleFactor;
          // bin.first_child.height = iconSize * 0.8 * scaleFactor;
        }

        icon.set_size(iconSize, iconSize);
        if (icon._img) {
          icon._img.set_icon_size(iconSize * this.extension.icon_quality);
        }

        // get nearest
        let bposcenter = [...pos];
        bposcenter[0] += (iconSize * scaleFactor) / 2;
        bposcenter[1] += (iconSize * scaleFactor) / 2;
        let dst = this._get_distance(pointer, bposcenter);

        if (
          (nearestDistance == -1 || nearestDistance > dst) &&
          dst < iconSize * ANIM_ICON_HIT_AREA * scaleFactor
        ) {
          nearestDistance = dst;
          nearestIcon = icon;
          nearestIdx = idx;
          icon._distance = dst;
          icon._dx = bposcenter[0] - pointer[0];
          icon._dy = bposcenter[1] - pointer[1];
        }

        icon._target = pos;
        icon._targetScale = 1;
        icon._targetSpread = iconSpacing * scaleFactor;

        if (icon === firstIcon) {
          if (this.vertical) {
            if (pos[1] > this.dashContainer.dash.y + iconSize * 2) {
              validPosition = false;
            }
          } else {
            if (pos[0] > this.dashContainer.dash.x + iconSize * 2) {
              validPosition = false;
            }
          }
        }

        idx++;
      });

      let didAnimate = false;
      let didScale = false;

      animateIcons.forEach((i) => {
        if (!i._pos) return;
        let p = [...i._pos];
        if (!p) return;
        i._pos = p;
      });

      this._nearestIcon = nearestIcon;

      let px = pointer[0];
      let py = pointer[1];
      if (this._preview > 0 && nearestIcon) {
        px = nearestIcon._pos[0];
        py = nearestIcon._pos[1];
      }

      // icons will spreadout when pointer hovers over the dash
      let icon_spacing =
        iconSize * (1.2 + this.extension.animation_spread / 4) * scaleFactor;

      //------------------------
      // animation behavior
      //------------------------
      if (animateIcons.length && nearestIcon) {
        let animation_type = this.extension.animation_type;

        let vertical = this.vertical ? this.dashContainer._position : 0;

        let anim = Animation(animateIcons, pointer, {
          iconsCount: animateIcons.length,
          iconSize,
          iconSpacing,
          dock_position,
          pointer: [px, py],
          x: this.dashContainer.x,
          y: this.dashContainer.y,
          width: this.dashContainer.width,
          height: this.dashContainer.height,
          scaleFactor,
          animation_rise: this.extension.animation_rise * ANIM_ICON_RAISE,
          animation_magnify: this.extension.animation_magnify * ANIM_ICON_SCALE,
          animation_spread: this.extension.animation_spread,
          vertical,
        });

        // commit
        animateIcons.forEach((i) => {
          i._target = [i._pos[0], i._pos[1]];
        });
      }

      if (!nearestIcon) {
        animateIcons.forEach((i) => {
          if (!i._container.visible) return;
          if (this.vertical) {
            i._container.height = iconSpacing * scaleFactor;
          } else {
            i._container.width = iconSpacing * scaleFactor;
          }
        });
      }

      //------------------------
      // animate icons (scale, spread)
      //------------------------
      let _scale_coef = ANIM_SCALE_COEF;
      let _spread_coef = ANIM_SPREAD_COEF;
      let _pos_coef = ANIM_POS_COEF;
      if (this.extension.animation_fps > 0) {
        _pos_coef /= 1 + this.extension.animation_fps / 2;
        _scale_coef /= 1 + this.extension.animation_fps / 2;
        _spread_coef /= 1 + this.extension.animation_fps / 2;
      }
      if (!nearestIcon) {
        _scale_coef *= ANIM_ON_LEAVE_COEF;
        _pos_coef *= ANIM_ON_LEAVE_COEF;
        _spread_coef *= ANIM_ON_LEAVE_COEF;
      }

      let dotIndex = 0;
      let has_errors = false;

      let scaleJump = 0; // this._inDash ? 0.08 : 0;

      // animate to target scale and position
      // todo .. make this velocity based
      animateIcons.forEach((icon) => {
        let pos = icon._target;
        let scale = (iconSize / icon.width) * icon._targetScale;
        let fromScale = icon.get_scale()[0];

        if (icon._targetScale > 1.2) {
          didScale = true;
        }

        // could happen at login? < recheck
        icon.visible = !isNaN(pos[0]);
        if (!icon.visible) {
          return;
        }

        icon.set_scale(1, 1);
        let from = this._get_position(icon);
        let dst = this._get_distance(from, icon._target);

        scale = (fromScale * _scale_coef + scale) / (_scale_coef + 1);

        if (
          dst > 8 * scaleFactor &&
          dst > iconSize * 0.01 &&
          dst < iconSize * 4
        ) {
          pos[0] = (from[0] * _pos_coef + pos[0]) / (_pos_coef + 1);
          pos[1] = (from[1] * _pos_coef + pos[1]) / (_pos_coef + 1);
          didAnimate = true;
        }

        if (isNaN(dst)) {
          // opening app? added favorite?
          has_errors = true;
        }

        if (scale < 1.0) {
          scale = 1.0;
        }
        // scale = scale.toFixed(3);

        let targetSpread = icon._targetSpread;
        // Math.floor(iconSpacing * scaleFactor * scale);

        // if (icon._icon.icon_name == 'spotify-client') {
        //   targetSpread += iconSize * scaleFactor;
        //   icon._img.translation_x = -iconSize/2 * scaleFactor;
        // } else {
        //   icon._img.translation_x = 0;
        // }

        if (scale <= 1.0) {
          targetSpread = iconSpacing * scaleFactor;
        }

        if (this.vertical) {
          let newHeight =
            (icon._container.height * _spread_coef + targetSpread) /
            (_spread_coef + 1);
          icon._container.height = newHeight;
        } else {
          let newWidth =
            (icon._container.width * _spread_coef + targetSpread) /
            (_spread_coef + 1);
          icon._container.width = newWidth;
        }

        // scale
        if (!isNaN(scale)) {
          icon.set_scale(scale + scaleJump, scale + scaleJump);
        }

        if (!isNaN(pos[0]) && !isNaN(pos[1])) {
          switch (dock_position) {
            case 'bottom':
              icon.set_position(
                pos[0] - 2,
                this.dashContainer.y - this.dashContainer.height + 4
              );
              break;
            case 'right':
              icon.set_position(
                this.dashContainer.x - this.dashContainer.width + 4,
                pos[1] - 2
              );
              break;
            case 'left':
              icon.set_position(this.dashContainer.x + 8, pos[1] + 2);
              break;
          }

          icon._pos = [...pos];
          icon._scale = scale;

          // todo find appsButton._label
          if (icon._label && !this._dragging) {
            if (icon == nearestIcon) {
              switch (dock_position) {
                case 'left':
                  icon._label.x = pos[0] + iconSize * scale * 1.1 * scaleFactor;
                  break;
                case 'right':
                  icon._label.x = pos[0] - iconSize * scale * 1.1 * scaleFactor;
                  icon._label.x -= icon._label.width / 1.2;
                  break;
                case 'bottom':
                  icon._label.x =
                    (-icon._label.width / 2 + icon.width / 2) * scaleFactor +
                    pos[0];
                  icon._label.y = pos[1] - iconSize * scale * 1.3 * scaleFactor;
                  break;
              }
              if (this.vertical) {
                icon._label.y = pos[1];
              }
            }
          }
        }
      });

      if (didScale || this._dragging) {
        this._debounceEndAnimation();
      }
      if (!didAnimate && !this._dragging && this._throttleDown <= 0) {
        this._throttleDown = THROTTLE_DOWN_FRAMES + THROTTLE_DOWN_DELAY_FRAMES;
      }

      this._didAnimate = didAnimate;
    }

    _get_position(obj) {
      return [...obj.get_transformed_position()];
    }

    _get_distance_sqr(pos1, pos2) {
      let a = pos1[0] - pos2[0];
      let b = pos1[1] - pos2[1];
      return a * a + b * b;
    }

    _get_distance(pos1, pos2) {
      return Math.sqrt(this._get_distance_sqr(pos1, pos2));
    }

    _isWithinDash(p) {
      let pad = 0;
      let x1 = this.dashContainer.x;
      let y1 = this.dashContainer.y;
      let x2 = this.dashContainer.x + this.dashContainer.width;
      let y2 = this.dashContainer.y + this.dashContainer.height;
      if (this.vertical) {
        x1 = this.dashContainer.x;
        x2 += this.dashContainer.width + this._dockExtension.width;
        y1 = this.dashContainer.y;
      }
      let [px, py] = p;
      return px + pad >= x1 && px - pad < x2 && py + pad >= y1 && py - pad < y2;
    }

    _createEffect(idx) {
      let effect = null;
      switch (idx) {
        case 1: {
          effect = new TintEffect({
            name: 'color',
            color: this.extension.icon_effect_color,
          });
          effect.preload(this.extension.path);
          break;
        }
        case 2: {
          effect = new MonochromeEffect({
            name: 'color',
            color: this.extension.icon_effect_color,
          });
          effect.preload(this.extension.path);
          break;
        }
      }
      return effect;
    }

    _updateIconEffect() {
      this._iconsContainer.remove_effect_by_name('icon-effect');
      let effect = this._createEffect(this.extension.icon_effect);
      if (effect) {
        this._iconsContainer.add_effect_with_name('icon-effect', effect);
      }
      this.iconEffect = effect;
    }

_beginAnimation(caller) {
    // if (caller) {
    //   log(`animation triggered by ${caller}`);
    // }

    if (this.extension._hiTimer && this._debounceEndSeq) {
      this.extension._loTimer.runDebounced(this._debounceEndSeq);
      // this.extension._loTimer.cancel(this._debounceEndSeq);
    }

    this._throttleDown = 0;

    this.animationInterval = this.extension.animationInterval;
    if (this.extension._hiTimer) {
      if (!this._animationSeq) {
        this._animationSeq = this.extension._hiTimer.runLoop(
          () => {
            this._animate();
          },
          this.animationInterval,
          'animationTimer'
        );
      } else {
        this.extension._hiTimer.runLoop(this._animationSeq);
      }
    }
  }

  _endAnimation() {
    if (this.extension._hiTimer) {
      this.extension._hiTimer.cancel(this._animationSeq);
      this.extension._loTimer.cancel(this._debounceEndSeq);
    }
    this._relayout = 0;
    if (this._dockExtension) {
      this._dockExtension.visible = false;
    }
  }

    _debounceEndAnimation() {
      if (this.extension._loTimer) {
        if (!this._debounceEndSeq) {
          this._debounceEndSeq = this.extension._loTimer.runDebounced(
            () => {
              this._endAnimation();
            },
            ANIM_DEBOUNCE_END_DELAY + this.animationInterval,
            'debounceEndAnimation'
          );
        } else {
          this.extension._loTimer.runDebounced(this._debounceEndSeq);
        }
      }
    }

    _onButtonEvent() {
      // button!
    }

    _onMotionEvent() {
      this._beginAnimation();
    }

    _onEnterEvent() {
      this._beginAnimation();
    }

    _onLeaveEvent() {
      this._debounceEndAnimation();
    }
  }
);
