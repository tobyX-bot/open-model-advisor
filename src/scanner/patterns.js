function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

function uppercase(value) {
  return value.toUpperCase();
}

function freezePatterns(patterns) {
  for (const pattern of patterns) {
    Object.freeze(pattern.regex);
    Object.freeze(pattern);
  }
  return Object.freeze(patterns);
}

export const SYSTEM_PATTERNS = freezePatterns([
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

export const CPU_MODEL_PATTERNS = freezePatterns([
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
    regex: /\bApple[ \t]+M(?<generation>[1-4])(?:[ \t]*(?<suffix>Pro|Max|Ultra))?\b(?![A-Z0-9-])/iu,
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
    id: "cpu.apple-m-contextual",
    field: "cpuModel",
    vendor: "apple",
    regex: /\bM(?<generation>[1-4])(?:[ \t]*(?<suffix>Pro|Max|Ultra))?\b(?![A-Z0-9-])/iu,
    requiresAppleContext: true,
    rejectsStorageContext: true,
    confidence: "high",
    specificity: 90,
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
    generic: true,
    confidence: "low",
    specificity: 10,
    normalize(match) {
      return compact(match.groups.evidence);
    }
  }
]);

export const GPU_MODEL_PATTERNS = freezePatterns([
  {
    id: "gpu.nvidia-rtx",
    field: "gpuModel",
    vendor: "nvidia",
    dedicated: true,
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
    dedicated: true,
    regex: /\b(?:AMD[ \t]+)?(?:Radeon[ \t]+)?RX[ \t]*(?<model>[0-9]{3,4})(?<xt>[ \t]+XT)?(?![A-Z0-9-])/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      return `AMD Radeon RX ${match.groups.model}${match.groups.xt ? " XT" : ""}`;
    }
  },
  {
    id: "gpu.amd-radeon-vega-dedicated",
    field: "gpuModel",
    vendor: "amd",
    dedicated: true,
    regex: /\bAMD[ \t]+Radeon[ \t]+Vega[ \t]+(?<model>56|64)(?![A-Z0-9-])/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      return `AMD Radeon Vega ${match.groups.model}`;
    }
  },
  {
    id: "gpu.amd-vega",
    field: "gpuModel",
    vendor: "amd",
    dedicated: false,
    regex: /\bAMD[ \t]+(?:Radeon[ \t]+)?Vega[ \t]+(?<model>(?!(?:56|64)\b)[0-9]{1,2})(?![A-Z0-9-])/iu,
    confidence: "high",
    specificity: 100,
    normalize(match) {
      return `AMD Vega ${match.groups.model}`;
    }
  },
  {
    id: "gpu.intel-arc",
    field: "gpuModel",
    vendor: "intel",
    dedicated: true,
    regex: /\bIntel[ \t]+Arc[ \t]+(?<model>[A-Z][0-9]{3,4}[A-Z]?)(?![A-Z0-9-])/iu,
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
    dedicated: false,
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
    dedicated: false,
    regex: /\b(?:no|without(?:[ \t]+a)?)[ \t]+(?:dedicated|discrete)[ \t]+(?:GPU|graphics(?:[ \t]+card)?)\b|no[ \t]+gpu|cpu[ \t]*-?[ \t]*only|integrated[ \t]+graphics[ \t]+only|无独立显卡|無獨立顯卡|没有(?:独显|独立显卡)|沒有(?:獨顯|獨立顯卡)|不(?:含|带|帶)(?:独立显卡|獨立顯卡)|仅[ \t]*cpu|僅[ \t]*cpu|只有[ \t]*cpu|核显|核顯|集成显卡|集成顯卡/iu,
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
    dedicated: true,
    regex: /\b(?<evidence>NVIDIA[ \t]+(?!RTX\b|GTX\b)[A-Z][A-Z0-9-]{1,23}[ \t]+(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{0,23})(?![A-Z0-9-])/iu,
    evidenceGroup: "evidence",
    generic: true,
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
    dedicated: true,
    regex: /\b(?<evidence>AMD[ \t]+(?!Radeon\b|RX\b|Ryzen\b|EPYC\b|Threadripper\b)[A-Z][A-Z0-9-]{1,23}[ \t]+(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{0,23})(?![A-Z0-9-])/iu,
    evidenceGroup: "evidence",
    generic: true,
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
    dedicated: false,
    regex: /\b(?<evidence>Intel[ \t]+(?!Core\b|Xeon\b)[A-Z][A-Z0-9-]{1,23}[ \t]+(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{0,23})(?![A-Z0-9-])/iu,
    evidenceGroup: "evidence",
    generic: true,
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
    dedicated: false,
    regex: /(?:\bGPU\b|\bgraphics[ \t]+card\b|\bvideo[ \t]+card\b|显卡|顯卡|图形卡|圖形卡)[ \t]*(?:model[ \t]*)?:?[ \t]*(?<evidence>[A-Z][A-Z0-9-]{1,23}(?:[ \t]+[A-Z][A-Z0-9-]{1,23})?[ \t]+(?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{0,23})(?![A-Z0-9-])/iu,
    evidenceGroup: "evidence",
    generic: true,
    confidence: "low",
    specificity: 10,
    normalize(match) {
      return compact(match.groups.evidence);
    }
  }
]);

export const CAPACITY_LABEL_PATTERNS = freezePatterns([
  {
    id: "capacity.label.unified-memory",
    field: "ram",
    memoryKind: "unified",
    regex: /\bunified[ \t]+memory\b|统一内存|統一內存|统一記憶體|統一記憶體/iu,
    confidence: "high",
    specificity: 120
  },
  {
    id: "capacity.label.vram",
    field: "vram",
    regex: /\bVRAM\b|\b(?:GPU|video|graphics)[ \t]+memory\b|显卡内存|顯卡內存|显卡記憶體|顯卡記憶體|图形内存|圖形內存|图形記憶體|圖形記憶體|显存|顯存/iu,
    confidence: "high",
    specificity: 110
  },
  {
    id: "capacity.label.system-memory",
    field: "ram",
    regex: /\b(?:system|main)[ \t]+memory\b|系统内存|系統內存|系统內存|系統記憶體|系统記憶體|主内存|主內存|主記憶體/iu,
    confidence: "high",
    specificity: 110
  },
  {
    id: "capacity.label.ram",
    field: "ram",
    regex: /\bRAM\b|\bmemory\b|内存|內存|記憶體/iu,
    confidence: "high",
    specificity: 100
  },
  {
    id: "capacity.label.storage",
    field: "storage",
    regex: /(?:(?:\b(?:free|available|total)[ \t]+)|(?:可用|剩余|剩餘|空闲|空閒|总计|總計|总容量|總容量)[ \t]*)?(?:\b(?:storage|SSD|HDD|disk|drive)\b|固态硬盘|固態硬盤|固态硬碟|固態硬碟|存储|存儲|硬盘|硬盤|硬碟)/iu,
    confidence: "high",
    specificity: 100
  }
]);

export const CAPACITY_AMOUNT_PATTERNS = freezePatterns([
  {
    id: "capacity.amount.tib",
    sourceUnit: "TiB",
    multiplier: 1024,
    memory: true,
    storage: true,
    regex: /(?<![A-Z0-9.])(?<amount>\d{1,5})[ \t-]*TiB(?![A-Z0-9/])/iu
  },
  {
    id: "capacity.amount.tb",
    sourceUnit: "TB",
    multiplier: 1000,
    memory: true,
    storage: true,
    regex: /(?<![A-Z0-9.])(?<amount>\d{1,5})[ \t-]*TB(?![A-Z0-9/])/iu
  },
  {
    id: "capacity.amount.gib",
    sourceUnit: "GiB",
    multiplier: 1,
    memory: true,
    storage: true,
    regex: /(?<![A-Z0-9.])(?<amount>\d{1,5})[ \t-]*GiB(?![A-Z0-9/])/iu
  },
  {
    id: "capacity.amount.gb",
    sourceUnit: "GB",
    multiplier: 1,
    memory: true,
    storage: true,
    regex: /(?<![A-Z0-9.])(?<amount>\d{1,5})[ \t-]*GB(?![A-Z0-9/])/iu
  },
  {
    id: "capacity.amount.gigabyte",
    sourceUnit: "gigabyte",
    multiplier: 1,
    memory: true,
    storage: false,
    regex: /(?:\babout[ \t]+)?(?<![A-Z0-9.])(?<amount>\d{1,5})[ \t-]*gigabytes?\b(?!\/)/iu
  },
  {
    id: "capacity.amount.gig",
    sourceUnit: "gig",
    multiplier: 1,
    memory: true,
    storage: false,
    regex: /(?:\babout[ \t]+)?(?<![A-Z0-9.])(?<amount>\d{1,5})[ \t-]*gigs?\b(?!\/)/iu
  },
  {
    id: "capacity.amount.g",
    sourceUnit: "G",
    multiplier: 1,
    memory: true,
    storage: false,
    regex: /(?<![A-Z0-9.])(?<amount>\d{1,5})[ \t-]*G(?![A-Z0-9/])/iu
  }
]);

export const CAPACITY_RANGE_PATTERNS = freezePatterns([
  {
    id: "capacity.range.two-units",
    regex: /(?<![A-Z0-9.])(?<left>\d{1,5})[ \t]*(?:TiB|TB|GiB|GB|G|gigabytes?|gigs?)[ \t]*(?:to|or|或(?:者)?|至|[-–—~～])[ \t]*(?<right>\d{1,5})[ \t]*(?:TiB|TB|GiB|GB|G|gigabytes?|gigs?)(?![A-Z0-9/])/iu
  },
  {
    id: "capacity.range.shared-trailing-unit",
    regex: /(?<![A-Z0-9.])(?<left>\d{1,5})[ \t]*(?:to|or|或(?:者)?|至|[-–—~～])[ \t]*(?<right>\d{1,5})[ \t]*(?:TiB|TB|GiB|GB|G|gigabytes?|gigs?)(?![A-Z0-9/])/iu,
    bareEndpoint: "left"
  },
  {
    id: "capacity.range.shared-leading-unit",
    regex: /(?<![A-Z0-9.])(?<left>\d{1,5})[ \t]*(?:TiB|TB|GiB|GB|G|gigabytes?|gigs?)[ \t]*(?:to|or|或(?:者)?|至|[-–—~～])[ \t]*(?<right>\d{1,5})(?![A-Z0-9.])/iu,
    bareEndpoint: "right"
  }
]);

export const CAPACITY_DISQUALIFIER_PATTERNS = freezePatterns([
  {
    id: "capacity.disqualifier.english",
    regex: /\b(?:less[ \t]+than|more[ \t]+than|under|over|at[ \t]+least|at[ \t]+most|up[ \t]+to|min(?:imum)?|max(?:imum)?|require|required|requires|requiring|need|needs|needed)\b/iu
  },
  {
    id: "capacity.disqualifier.english-exact-negation",
    regex: /\bnot\b/iu,
    requireAmountAdjacency: true
  },
  {
    id: "capacity.disqualifier.english-capability",
    regex: /\b(?:(?:can[ \t]+)?support(?:s|ed|ing)?(?:[ \t]+for)?|capable[ \t]+of)\b/iu,
    requireCapacityAdjacency: true
  },
  {
    id: "capacity.disqualifier.chinese",
    regex: /不是|并非|並非|不等于|不等於|小于|小於|少于|少於|低于|低於|大于|大於|高于|高於|至少|至多|最多|最高|上限|不少于|不少於|不超过|不超過|需要|要求/u
  },
  {
    id: "capacity.disqualifier.chinese-capability",
    regex: /可支持|可支援|支持|支援/u,
    requireCapacityAdjacency: true
  },
  {
    id: "capacity.disqualifier.chinese-negation",
    regex: /没有|沒有|不含|无|無/u,
    requireCapacityAdjacency: true
  },
  {
    id: "capacity.disqualifier.english-postposed",
    regex: /\b(?:(?:or|and)[ \t-]+(?:more|less|greater|higher|above|up)|at[ \t]+(?:least|most)|min(?:imum)?|max(?:imum)?|(?:is[ \t]+)?(?:required|needed))(?![A-Z0-9-])/iu,
    allowAfterCapacity: true
  },
  {
    id: "capacity.disqualifier.english-postposed-absence",
    regex: /\b(?:(?:(?:modules?|DIMMs?|kits?|sticks?|memory)[ \t]+)?(?:(?:is|are|was|were)[ \t]+)?(?:(?:currently|presently|still)[ \t]+)?(?:unavailable|not[ \t]+(?:(?:currently|presently|still)[ \t]+)?(?:installed|available|present|included))|(?:(?:is|are|was|were)[ \t]+)?(?:absent|missing)(?=[ \t]*(?:$|[,，.。!?！？])))\b/iu,
    allowAfterCapacity: true
  },
  {
    id: "capacity.disqualifier.english-preposed-absence",
    regex: /\b(?:without|no)\b/iu,
    requireCapacityAdjacency: true
  },
  {
    id: "capacity.disqualifier.english-uncertainty",
    regex: /\b(?:maybe|possibly|probably|approximately|roughly|perhaps|about|around)\b/iu,
    preserveNaturalMemoryAbout: true
  },
  {
    id: "capacity.disqualifier.chinese-uncertainty",
    regex: /大约|大約|大概|近似|约|約|可能|或许|或許|也许|也許/u,
    preserveApproximateRamContract: true
  },
  {
    id: "capacity.disqualifier.english-postposed-uncertainty",
    regex: /\b(?:maybe|possibly|probably|approximately|roughly|perhaps|about|around)\b(?=[ \t]*(?:$|[,，.。!?！？]))/iu,
    allowAfterCapacity: true
  },
  {
    id: "capacity.disqualifier.chinese-postposed-uncertainty",
    regex: /(?:左右|上下)(?=[ \t]*(?:$|[,，.。!?！？]))/u,
    allowAfterCapacity: true
  },
  {
    id: "capacity.disqualifier.symbolic-bound",
    regex: /(?:<=|>=|[<>≤≥])/u,
    allowAfterCapacity: true
  },
  {
    id: "capacity.disqualifier.compact-plus",
    regex: /\+(?![ \t]*\d)/u,
    allowAfterCapacity: true,
    requireAdjacentAfterCapacity: true
  },
  {
    id: "capacity.disqualifier.chinese-postposed",
    regex: /以上|以下|以内|以內/u,
    allowAfterCapacity: true
  },
  {
    id: "capacity.disqualifier.storage-used-english",
    regex: /\b(?:(?:is|are|was|were)[ \t]+)?(?:used|occupied)\b/iu,
    allowAfterCapacity: true,
    storageOnly: true
  },
  {
    id: "capacity.disqualifier.storage-used-chinese",
    regex: /已使用|已用|使用了|用了|已占用|已佔用|占用|佔用/u,
    allowAfterCapacity: true,
    storageOnly: true
  }
]);

export const DEDICATED_GPU_EVIDENCE_PATTERNS = freezePatterns([
  {
    id: "capacity.dedicated-gpu.explicit",
    regex: /\b(?:(?:dedicated|discrete|external)[ \t]+(?:GPU|graphics(?:[ \t]+card)?)|eGPU)\b|独立显卡|獨立顯卡/iu
  },
  {
    id: "capacity.dedicated-gpu.vendor",
    regex: /\b(?:NVIDIA[ \t]+GPU|AMD[ \t]+GPU|GPU[ \t]*(?::[ \t]*)?(?:NVIDIA|AMD)|GeForce|RTX|Radeon|Intel[ \t]+Arc)\b/iu
  }
]);

export const STORAGE_KIND_PATTERNS = freezePatterns([
  {
    id: "capacity.storage-kind.free",
    kind: "free",
    regex: /\b(?:free|available|remaining)\b|可用|剩余|剩餘|空闲|空閒|(?:硬盘|硬盤|硬碟)[ \t]*(?:还剩|還剩|剩)(?=[ \t:]*\d)/iu
  },
  {
    id: "capacity.storage-kind.total",
    kind: "total",
    regex: /\b(?:total|capacity)\b|总计|總計|总容量|總容量/iu
  }
]);

export const CAPACITY_CLAUSE_PATTERNS = freezePatterns([
  {
    id: "capacity.clause.punctuation",
    regex: /[,，.。!?！？]/u
  },
  {
    id: "capacity.clause.english-conjunction",
    regex: /[ \t]+\b(?:but|and(?![ \t]+(?:more|less|greater|higher|above|up)(?![A-Z0-9-])(?:[ \t]*[)）])?[ \t]*(?:$|[,，.。!?！？])))\b[ \t]+/iu
  },
  {
    id: "capacity.clause.english-with",
    regex: /[ \t]+\bwith\b[ \t]+(?=(?:(?:RAM|VRAM|memory|storage|SSD|HDD|disk|drive|NVIDIA|AMD|Intel|Apple|GeForce|RTX|Radeon|RX|Arc|CPU|GPU)\b|统一内存|統一內存|统一記憶體|統一記憶體|系统内存|系統内存|系統內存|系统記憶體|系統記憶體|显存|顯存|内存|內存|記憶體|存储|存儲|硬盘|硬盤|硬碟|\d{1,5}[ \t-]*(?:TiB|TB|GiB|GB|G)\b[ \t]+(?:(?:RAM|VRAM|memory|storage|SSD|HDD|disk|drive)\b|统一内存|統一內存|统一記憶體|統一記憶體|系统内存|系統内存|系統內存|系统記憶體|系統記憶體|显存|顯存|内存|內存|記憶體|存储|存儲|硬盘|硬盤|硬碟)))/iu
  },
  {
    id: "capacity.clause.symbol-conjunction",
    regex: /[ \t]*(?:\+(?![ \t]*(?:[)）][ \t]*)?(?:$|[,，.。!?！？]))|&)[ \t]*/u
  },
  {
    id: "capacity.clause.chinese-conjunction-long",
    regex: /[ \t]*(?:並且|并且|還有|还有|以及)[ \t]*/u
  },
  {
    id: "capacity.clause.chinese-conjunction-fully-spaced",
    regex: /[ \t]+(?:與|与|及|和)[ \t]+/u
  },
  {
    id: "capacity.clause.chinese-conjunction-short",
    regex: /(?<=[Bb])[ \t]*(?:與|与|及|和)[ \t]*(?=(?:(?:RAM|VRAM|NVIDIA|AMD|Intel|Apple|GeForce|RTX|Radeon|RX|Arc|CPU|GPU|memory|storage|SSD|HDD|disk|drive)\b|\d{1,5}[ \t-]*(?:TiB|TB|GiB|GB|G)\b|统一内存|統一內存|统一記憶體|統一記憶體|系统内存|系統內存|系统內存|系統記憶體|系统記憶體|主内存|主內存|主記憶體|显卡内存|顯卡內存|显卡記憶體|顯卡記憶體|图形内存|圖形內存|图形記憶體|圖形記憶體|显存|顯存|内存|內存|記憶體|固态硬盘|固態硬盤|固态硬碟|固態硬碟|存储|存儲|硬盘|硬盤|硬碟|显卡|顯卡|图形卡|圖形卡))/iu
  }
]);

export const TASK_PATTERNS = freezePatterns([
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
