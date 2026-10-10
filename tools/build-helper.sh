#!/bin/sh
# Compile the helpers.
#
# Both are optional: without them the panel falls back to the nominal frequency
# the runtime reports, and draws one CPU row instead of two — which is what the
# plugin did before the helpers existed. Building them needs the Xcode command
# line tools and nothing else: no package to install, no SDK, no driver.
#
# There are two, and a machine needs at most one of each:
#
#   dsh-ioreport  streams live frequency histograms, through a private IOKit
#                 interface that only exists on Apple silicon. It links the
#                 private symbols at load time through the dyld shared cache.
#   dsh-cpuid     asks an Intel hybrid CPU which of its cores is which, through
#                 CPUID leaf 0x1A — an x86 instruction, so it is built for an
#                 Intel Mac and is a one-line refusal anywhere else.
#
# Usage: tools/build-helper.sh
#
# ARCH=arm64|x86_64 builds for the other architecture than this machine has,
# which is the only way to check the one this machine cannot run.

set -e
cd "$(dirname "$0")/.."
mkdir -p bin

arch=${ARCH:-$(uname -m)}
case "$arch" in
  arm64 | aarch64)
    clang -O2 -Wall -Wextra -o bin/dsh-ioreport helper/dsh-ioreport.c \
      -framework IOKit \
      -framework CoreFoundation \
      -Wl,-undefined,dynamic_lookup
    echo "built bin/dsh-ioreport"
    echo "check it with: ./bin/dsh-ioreport -i 1000"
    echo "no bin/dsh-cpuid here: CPUID is an x86 instruction"
    ;;
  x86_64 | amd64)
    clang -O2 -Wall -Wextra -o bin/dsh-cpuid helper/dsh-cpuid.c
    echo "built bin/dsh-cpuid"
    echo "check it with: ./bin/dsh-cpuid"
    echo "no bin/dsh-ioreport here: IOReport is an Apple silicon interface"
    ;;
  *)
    echo "tools/build-helper.sh: no helper for this architecture ($arch)" >&2
    exit 1
    ;;
esac
