function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

function uppercase(value) {
  return value.toUpperCase();
}

export const SYSTEM_PATTERNS = Object.freeze([
  {
    id: "system.os.macos",
    field: "os",
    value: "macos",
    regex: /macbook|mac[ \t]*os|apple[ \t]+silicon|苹果电脑|蘋果電腦|苹果系统|蘋果系統|\bM[1-4](?:[ \t]*(?:Pro|Max|Ultra))?\b/iu,
    confidence: "high",
    specificity: 80
  },
  {
    id: "system.os.windows",
    field: "os",
    value: "windows",
    regex: /windows|\bwin(?:10|11)\b|微软系统|微軟系統|视窗系统|視窗系統/iu,
    confidence: "high",
    specificity: 80
  },
  {
    id: "system.os.linux",
    field: "os",
    value: "linux",
    regex: /\blinux\b|\bubuntu\b|\bdebian\b|\bfedora\b|\barch\b|麒麟|统信|統信/iu,
    confidence: "high",
    specificity: 80
  },
  {
    id: "system.device.laptop",
    field: "deviceType",
    value: "laptop",
    regex: /macbook|\blaptop\b|\bnotebook\b|笔记本|筆記本|笔电|筆電/iu,
    confidence: "high",
    specificity: 80
  },
  {
    id: "system.device.server",
    field: "deviceType",
    value: "server",
    regex: /\bserver\b|\brack\b|服务器|伺服器|机架|機架/iu,
    confidence: "high",
    specificity: 80
  },
  {
    id: "system.device.workstation",
    field: "deviceType",
    value: "workstation",
    regex: /\bworkstation\b|工作站/iu,
    confidence: "high",
    specificity: 80
  },
  {
    id: "system.device.desktop",
    field: "deviceType",
    value: "desktop",
    regex: /\bdesktop\b|\bpc\b|\btower\b|台式机|台式機|台式电脑|台式電腦|主机|主機/iu,
    confidence: "medium",
    specificity: 70
  }
]);

export const CPU_MODEL_PATTERNS = Object.freeze([
  {
    id: "cpu.intel-core-ultra",
    field: "cpuModel",
    vendor: "intel",
    regex: /\b(?:Intel[ \t]+)?Core[ \t]+Ultra[ \t]+(?<tier>[3579])[ \t]*(?<model>[0-9]{3}[A-Z]{0,3})\b/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      return `Intel Core Ultra ${match.groups.tier} ${uppercase(match.groups.model)}`;
    }
  },
  {
    id: "cpu.intel-core",
    field: "cpuModel",
    vendor: "intel",
    regex: /\b(?:Intel[ \t]+)?(?:Core[ \t]+)?i(?<tier>[3579])(?:[ \t]*-[ \t]*|[ \t]+)?(?<model>[0-9]{3,5}[A-Z]{0,3})\b/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      return `Intel Core i${match.groups.tier}-${uppercase(match.groups.model)}`;
    }
  },
  {
    id: "cpu.amd-ryzen",
    field: "cpuModel",
    vendor: "amd",
    regex: /\b(?:AMD[ \t]+)?Ryzen[ \t]+(?<tier>[3579])[ \t]*(?<model>[0-9]{4}[A-Z0-9]{0,4})\b/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      return `AMD Ryzen ${match.groups.tier} ${uppercase(match.groups.model)}`;
    }
  },
  {
    id: "cpu.intel-xeon",
    field: "cpuModel",
    vendor: "intel",
    regex: /\b(?:Intel[ \t]+)?Xeon(?:[ \t]+(?<class>Platinum|Gold|Silver|Bronze))?[ \t]+(?<model>[0-9]{4}[A-Z]{0,3})\b/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      const processorClass = match.groups.class
        ? `${match.groups.class[0].toUpperCase()}${match.groups.class.slice(1).toLowerCase()} `
        : "";
      return `Xeon ${processorClass}${uppercase(match.groups.model)}`;
    }
  },
  {
    id: "cpu.amd-epyc",
    field: "cpuModel",
    vendor: "amd",
    regex: /\b(?:AMD[ \t]+)?EPYC[ \t]+(?<model>[0-9]{4}[A-Z]{0,3})\b/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      return `AMD EPYC ${uppercase(match.groups.model)}`;
    }
  },
  {
    id: "cpu.apple-m",
    field: "cpuModel",
    vendor: "apple",
    regex: /\b(?:Apple[ \t]+)?M(?<generation>[1-4])(?:[ \t]*(?<suffix>Pro|Max|Ultra))?\b/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      const suffix = match.groups.suffix
        ? ` ${match.groups.suffix[0].toUpperCase()}${match.groups.suffix.slice(1).toLowerCase()}`
        : "";
      return `Apple M${match.groups.generation}${suffix}`;
    }
  },
  {
    id: "cpu.labeled-unknown",
    field: "cpuModel",
    vendor: null,
    regex: /(?:\bCPU\b|\bprocessor\b|中央处理器|中央處理器|处理器|處理器)[ \t]*(?:model[ \t]*)?:?[ \t]*(?<evidence>[A-Z][A-Z0-9-]{1,23}(?:[ \t]+[A-Z][A-Z0-9-]{1,23})?[ \t]+(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{0,23})(?![A-Z0-9-])/iu,
    evidenceGroup: "evidence",
    confidence: "low",
    specificity: 10,
    normalize(match) {
      return compact(match.groups.evidence);
    }
  }
]);

export const GPU_MODEL_PATTERNS = Object.freeze([
  {
    id: "gpu.nvidia-rtx",
    field: "gpuModel",
    vendor: "nvidia",
    regex: /\b(?:NVIDIA[ \t]+)?(?:GeForce[ \t]+)?RTX[ \t]*(?<model>[0-9]{3,4})(?<ti>[ \t]+Ti)?(?<super>[ \t]+SUPER)?(?<laptop>[ \t]+Laptop[ \t]+GPU)?(?![A-Z0-9-])/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      return `NVIDIA RTX ${match.groups.model}${match.groups.ti ? " Ti" : ""}${match.groups.super ? " SUPER" : ""}${match.groups.laptop ? " Laptop GPU" : ""}`;
    }
  },
  {
    id: "gpu.amd-radeon-rx",
    field: "gpuModel",
    vendor: "amd",
    regex: /\b(?:AMD[ \t]+)?(?:Radeon[ \t]+)?RX[ \t]*(?<model>[0-9]{3,4})(?<xt>[ \t]+XT)?(?![A-Z0-9-])/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      return `AMD Radeon RX ${match.groups.model}${match.groups.xt ? " XT" : ""}`;
    }
  },
  {
    id: "gpu.intel-arc",
    field: "gpuModel",
    vendor: "intel",
    regex: /\bIntel[ \t]+Arc[ \t]+(?<model>[A-Z][0-9]{3,4})(?![A-Z0-9-])/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      return `Intel Arc ${uppercase(match.groups.model)}`;
    }
  },
  {
    id: "gpu.intel-iris-xe",
    field: "gpuModel",
    vendor: "intel",
    regex: /\bIntel[ \t]+Iris[ \t]+Xe\b/iu,
    confidence: "high",
    specificity: 100,
    normalize() {
      return "Intel Iris Xe";
    }
  },
  {
    id: "gpu.no-dedicated",
    field: "gpuModel",
    vendor: "none",
    regex: /no[ \t]+dedicated[ \t]+gpu|no[ \t]+gpu|cpu[ \t]*-?[ \t]*only|integrated[ \t]+graphics[ \t]+only|无独立显卡|無獨立顯卡|没有独显|沒有獨顯|仅[ \t]*cpu|僅[ \t]*cpu|只有[ \t]*cpu|核显|核顯|集成显卡|集成顯卡/iu,
    confidence: "high",
    specificity: 100,
    normalize() {
      return "No dedicated GPU";
    }
  },
  {
    id: "gpu.nvidia-labeled-unknown",
    field: "gpuModel",
    vendor: "nvidia",
    regex: /\b(?<evidence>NVIDIA[ \t]+(?!RTX\b|GTX\b)[A-Z][A-Z0-9-]{1,23}[ \t]+(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{0,23})(?![A-Z0-9-])/iu,
    evidenceGroup: "evidence",
    confidence: "low",
    vendorConfidence: "high",
    vendorSpecificity: 100,
    specificity: 10,
    normalize(match) {
      return `NVIDIA ${compact(match.groups.evidence).split(" ").slice(1).join(" ")}`;
    }
  },
  {
    id: "gpu.amd-labeled-unknown",
    field: "gpuModel",
    vendor: "amd",
    regex: /\b(?<evidence>AMD[ \t]+(?!Radeon\b|RX\b|Ryzen\b|EPYC\b|Threadripper\b)[A-Z][A-Z0-9-]{1,23}[ \t]+(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{0,23})(?![A-Z0-9-])/iu,
    evidenceGroup: "evidence",
    confidence: "low",
    vendorConfidence: "high",
    vendorSpecificity: 100,
    specificity: 10,
    normalize(match) {
      return `AMD ${compact(match.groups.evidence).split(" ").slice(1).join(" ")}`;
    }
  },
  {
    id: "gpu.intel-labeled-unknown",
    field: "gpuModel",
    vendor: "intel",
    regex: /\b(?<evidence>Intel[ \t]+(?!Core\b|Xeon\b)[A-Z][A-Z0-9-]{1,23}[ \t]+(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{0,23})(?![A-Z0-9-])/iu,
    evidenceGroup: "evidence",
    confidence: "low",
    vendorConfidence: "high",
    vendorSpecificity: 100,
    specificity: 10,
    normalize(match) {
      return `Intel ${compact(match.groups.evidence).split(" ").slice(1).join(" ")}`;
    }
  },
  {
    id: "gpu.labeled-unknown",
    field: "gpuModel",
    vendor: null,
    regex: /(?:\bGPU\b|\bgraphics[ \t]+card\b|\bvideo[ \t]+card\b|显卡|顯卡|图形卡|圖形卡)[ \t]*(?:model[ \t]*)?:?[ \t]*(?<evidence>(?!with\b|RAM\b|memory\b|VRAM\b|storage\b|SSD\b|chat\b|coding\b|image\b|speech\b|embedding\b)[A-Z][A-Z0-9-]{1,23}(?:[ \t]+[A-Z][A-Z0-9-]{1,23})?[ \t]+(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{0,23})(?![A-Z0-9-])/iu,
    evidenceGroup: "evidence",
    confidence: "low",
    specificity: 10,
    normalize(match) {
      return compact(match.groups.evidence);
    }
  }
]);

export const TASK_PATTERNS = Object.freeze([
  {
    id: "task.coding-llm",
    field: "task",
    value: "coding-llm",
    regex: /\bcoding[ \t]+assistant\b|\bcode[ \t]+assistant\b|\bprogramming\b|\bcoding\b|编程|編程|代码助手|代碼助手|写代码|寫代碼/iu,
    confidence: "medium",
    specificity: 80
  },
  {
    id: "task.image-generation",
    field: "task",
    value: "image-generation",
    regex: /\bimage[ \t]+generation\b|\bstable[ \t]+diffusion\b|\bsdxl\b|\bflux\b|\btext[ \t]*-[ \t]*to[ \t]*-[ \t]*image\b|图像生成|圖像生成|文生图|文生圖|绘图|繪圖/iu,
    confidence: "medium",
    specificity: 80
  },
  {
    id: "task.speech-to-text",
    field: "task",
    value: "speech-to-text",
    regex: /\btranscription\b|\bspeech[ \t]*(?:-[ \t]*)?to[ \t]*(?:-[ \t]*)?text\b|\bwhisper\b|转录|轉錄|语音转文字|語音轉文字|语音识别|語音識別/iu,
    confidence: "medium",
    specificity: 80
  },
  {
    id: "task.embeddings",
    field: "task",
    value: "embeddings",
    regex: /\brag\b|\bsearch\b|\bembedding\b|\bretrieval\b|检索|檢索|搜索|向量|知识库|知識庫/iu,
    confidence: "medium",
    specificity: 80
  },
  {
    id: "task.chat-llm",
    field: "task",
    value: "chat-llm",
    regex: /\bchat\b|\bwriting\b|\bassistant\b|对话|對話|写作|寫作|聊天/iu,
    confidence: "low",
    specificity: 40
  }
]);
