#!/bin/sh
set -e
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root/vendor/PixelOffice"
exec ./gradlew desktop:run
