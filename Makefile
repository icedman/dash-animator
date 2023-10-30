all: build install lint

.PHONY: build install

build:
	echo "glib-compile-schemas --strict --targetdir=schemas/ schemas"

install:
	mkdir -p ~/.local/share/gnome-shell/extensions/dash-animator@icedman.github.com/
	cp -R ./* ~/.local/share/gnome-shell/extensions/dash-animator@icedman.github.com/

publish:
	rm -rf build
	mkdir build
	cp LICENSE ./build
	cp *.js ./build
	cp metadata.json ./build
	cp stylesheet.css ./build
	cp README.md ./build
	echo "cp -R schemas ./build"
	rm -rf ./*.zip
	rm build/timer.js
	cd build ; \
	zip -qr ../dash-animator@icedman.github.com.zip .

test-prefs:
	gnome-extensions prefs dash-animator@icedman.github.com

test-shell: install
	env GNOME_SHELL_SLOWDOWN_FACTOR=2 \
		MUTTER_DEBUG_DUMMY_MODE_SPECS=1280x800 \
	 	MUTTER_DEBUG_DUMMY_MONITOR_SCALES=1 \
		dbus-run-session -- gnome-shell --nested --wayland
	rm /run/user/1000/gnome-shell-disable-extensions

lint:
	eslint ./

pretty:
	prettier --single-quote --write "**/*.js"
