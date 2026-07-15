export const weights = {
  task: 25,
  hardware: 25,
  memory: 15,
  workload: 10,
  priority: 15,
  runtime: 5,
  license: 5
};

export const presets = {
  "basic-laptop": {
    os: "windows",
    deviceType: "laptop",
    cpuModel: "Intel Core i5 laptop CPU",
    ram: 8,
    gpuVendor: "none",
    gpuModel: "No dedicated GPU",
    vram: 0,
    storage: 40,
    internet: "available",
    deployment: "local-first"
  },
  "cpu-only": {
    os: "linux",
    deviceType: "desktop",
    cpuModel: "Ryzen 7 CPU",
    ram: 16,
    gpuVendor: "none",
    gpuModel: "No dedicated GPU",
    vram: 0,
    storage: 100,
    internet: "available",
    deployment: "local-only"
  },
  "apple-16": {
    os: "macos",
    deviceType: "laptop",
    cpuModel: "Apple M-series",
    ram: 16,
    gpuVendor: "apple",
    gpuModel: "Apple unified GPU",
    vram: 12,
    storage: 120,
    internet: "available",
    deployment: "local-first"
  },
  "gaming-8": {
    os: "windows",
    deviceType: "desktop",
    cpuModel: "Ryzen 7 / Intel i7 gaming CPU",
    ram: 32,
    gpuVendor: "nvidia",
    gpuModel: "NVIDIA RTX 4060 Ti / RTX 3070 class",
    vram: 8,
    storage: 200,
    internet: "available",
    deployment: "local-first"
  },
  "creator-16": {
    os: "windows",
    deviceType: "workstation",
    cpuModel: "Intel i9 / Ryzen 9 creator CPU",
    ram: 64,
    gpuVendor: "nvidia",
    gpuModel: "NVIDIA RTX 4080 / RTX 4090 class",
    vram: 16,
    storage: 500,
    internet: "available",
    deployment: "local-first"
  },
  "server-24": {
    os: "linux",
    deviceType: "server",
    cpuModel: "Xeon / Threadripper server CPU",
    ram: 128,
    gpuVendor: "nvidia",
    gpuModel: "NVIDIA RTX 4090 / A-series 24GB+ GPU",
    vram: 24,
    storage: 1000,
    internet: "available",
    deployment: "local-first"
  }
};

export const helperSetups = {
  "m3-pro-36": "MacBook Pro M3 Pro, 36GB unified memory, macOS, coding assistant",
  "rtx-4070": "Ryzen 7 7800X3D desktop, NVIDIA RTX 4070 12GB VRAM, 32GB RAM, 1TB SSD, image generation",
  "intel-cpu-only": "Intel i5 laptop, 16GB RAM, no dedicated GPU, 512GB SSD, chat"
};

export const stageIds = ["raw", "scan", "extract", "match", "recommendation"];
