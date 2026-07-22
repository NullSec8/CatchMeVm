export const state = {
  emulator: null,
  mode: "gui",
  distro: "tinycore",
  uiBound: false,
  lastVmMemoryMb: 0,
  serialStatsCapture: null,
};

export const filesManifest = new Map();
export let selectedUploads = [];

export function setSelectedUploads(files) {
  selectedUploads = files;
}

export const DB_NAME = "catchmevm-db";
export const DB_VERSION = 2;
export const STORE = "files";
export const STORE_SNAPSHOTS = "snapshots";
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const AUTO_SNAPSHOT_ID = "auto-latest";

export const DISTRO_TINYCORE = "tinycore";
export const DISTRO_ARCH = "arch";

export const PREF_DISTRO = "catchmevm.distro";
export const PREF_BOOT_MODE = "catchmevm.bootMode";
export const PREF_QUALITY = "catchmevm.quality";
export const PREF_FAST_START = "catchmevm.fastStart";

export const GITHUB_ZIP_PROXY = "/api/github-zip";
