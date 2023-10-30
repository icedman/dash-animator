'use strict';

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

const Point = Graphene.Point;

export const DockIcon = GObject.registerClass(
  {},
  class DockIcon extends St.Widget {
    _init() {
      super._init({ name: 'DockIcon', reactive: false });

      let pivot = new Point();
      pivot.x = 0.5;
      pivot.y = 0.5;
      this.pivot_point = pivot;
    }

    update(params) {
      let gicon = null;
      let icon_gfx = params.icon?.icon_name;
      if (params.icon?.gicon) {
        let name = params.icon.gicon.name;
        if (!name && params.icon.gicon.names) {
          name = params.icon.gicon.names[0];
        }
        if (!name) {
          // hijack
          gicon = params.icon.gicon;
          icon_gfx = params.app;
        }
        if (name) {
          icon_gfx = name;
        }
      }

      // log(`--${icon_gfx}`);

      if (this._icon && this._gfx != icon_gfx) {
        this._gfx = icon_gfx;
        this.remove_child(this._icon);
        this._icon = null;
      }
      if (!this._icon && icon_gfx) {
        if (!gicon) {
          gicon = new Gio.ThemedIcon({ name: icon_gfx });
        }
        this._icon = new St.Icon({
          gicon,
        });

        // remove overlay added by services
        if (this.first_child) {
          this.remove_child(this.first_child);
        }

        this.add_child(this._icon);
      }
      this.visible = true;
    }
  }
);

export const IconsContainer = GObject.registerClass(
  {},
  class IconsContainer extends St.Widget {
    _init(params) {
      super._init({
        name: 'IconsContainer',
        ...(params || {}),
      });
      this._icons = [];
    }

    _precreate_icons(length) {
      while (this._icons.length < length) {
        let icon = new DockIcon();
        this._icons.push(icon);
        this.add_child(icon);
      }
      this._icons.forEach((icon) => {
        icon.visible = false;
      });

      return this._icons;
    }

    clear() {
      this._icons.forEach((i) => {
        this.remove_child(i);
      });
      this._icons = [];
    }

    update(params) {
      let { icons, pivot, iconSize, quality, scaleFactor } = params;
      if (!icons) {
        icons = [];
      }
      this._precreate_icons(icons.length);
      let idx = 0;

      icons.forEach((container) => {
        const { _appwell, _bin, _label, _showApps } = container;

        let _icon = this._icons[idx++];
        _icon.update({
          icon: container._icon,
          app: _appwell?.app?.get_id(),
        });

        container._renderedIcon = _icon;

        _icon._appwell = _appwell;
        _icon._showApps = _showApps;
        _icon._bin = _bin;
        _icon._label = _label;
        _icon._img = _icon._icon;
        _icon._container = container;

        if (_icon._img) {
          _icon._img.set_size(iconSize * quality, iconSize * quality);
          _icon._img.set_scale(1 / quality, 1 / quality);
        }

        _icon.set_size(iconSize, iconSize);
        _icon.pivot_point = pivot;
      });
    }

    // move animation here!
    animate() {}
  }
);

export const DockBackground = GObject.registerClass(
  {},
  class DockBackground extends St.Widget {
    _init(params) {
      super._init({
        name: 'DockBackground',
        ...(params || {}),
      });
    }

    update(params) {
      let {
        first,
        last,
        padding,
        iconSize,
        scaleFactor,
        vertical,
        position,
        panel_mode,
        dashContainer,
      } = params;

      padding *= 0.5;

      let p1 = first.get_transformed_position();
      let p2 = last.get_transformed_position();

      if (!isNaN(p1[0]) && !isNaN(p1[1])) {
        // bottom
        this.x = p1[0] - padding;
        this.y = first._fixedPosition[1] - padding; // p1[1] - padding

        if (p2[1] > p1[1]) {
          this.y = p2[1] - padding;
        }
        let width =
          p2[0] -
          p1[0] +
          iconSize * scaleFactor * last._targetScale +
          padding * 2;
        let height = iconSize * scaleFactor + padding * 2;

        if (!isNaN(width)) {
          this.width = width;
        }
        if (!isNaN(width)) {
          this.height = height;
        }

        // vertical
        if (vertical) {
          this.x = p1[0] - padding;
          this.y = first._fixedPosition[1] - padding; // p1[1] - padding

          if (position == 'right' && p2[0] > p1[0]) {
            this.x = p2[0] - padding;
          }
          if (position == 'left' && p2[0] < p1[0]) {
            this.x = p2[0] - padding;
          }

          this.width = iconSize * scaleFactor + padding * 2;
          this.height =
            p2[1] -
            p1[1] +
            iconSize * scaleFactor * last._targetScale +
            padding * 2;

          // log(`${width} ${height}`);
        }

        if (panel_mode) {
          if (vertical) {
            this.y = dashContainer.y;
            this.height = dashContainer.height;
          } else {
            let pad = 0; //dashContainer.cornerPad || 0;
            this.x = dashContainer.x - pad;
            this.width = dashContainer.width + pad * 2;
            this.height++;
          }
        }
      }
    }
  }
);
