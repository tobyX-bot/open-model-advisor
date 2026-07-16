import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEED = 20260716;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(ROOT, "fixtures", "computer_setups_200.json");

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

const random = createRandom(SEED);

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function repeat(value, count) {
  return Array.from({ length: count }, () => value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const pairTemplates = [
  { os: "windows", deviceType: "laptop", task: "chat-llm", deployment: "local-first", hardwareTier: "entry" },
  { os: "macos", deviceType: "laptop", task: "coding-llm", deployment: "local-first", hardwareTier: "mainstream" },
  { os: "windows", deviceType: "desktop", task: "image-generation", deployment: "cloud-ok", hardwareTier: "performance" },
  { os: "linux", deviceType: "desktop", task: "embeddings", deployment: "local-only", hardwareTier: "extreme" }
];

const pairPresentation = [
  [{ languageStyle: "en", scenarioClass: "clean" }, { languageStyle: "zh-CN", scenarioClass: "clean" }],
  [{ languageStyle: "en", scenarioClass: "clean" }, { languageStyle: "zh-TW", scenarioClass: "clean" }],
  [{ languageStyle: "en", scenarioClass: "clean" }, { languageStyle: "mixed", scenarioClass: "messy" }],
  [{ languageStyle: "en", scenarioClass: "messy" }, { languageStyle: "zh-CN", scenarioClass: "messy" }]
];

const remainingJointDevices = [
  ...repeat({ os: "windows", deviceType: "laptop" }, 6),
  ...repeat({ os: "windows", deviceType: "desktop" }, 5),
  ...repeat({ os: "windows", deviceType: "workstation" }, 3),
  ...repeat({ os: "macos", deviceType: "laptop" }, 6),
  ...repeat({ os: "macos", deviceType: "desktop" }, 3),
  ...repeat({ os: "macos", deviceType: "workstation" }, 1),
  ...repeat({ os: "linux", deviceType: "laptop" }, 2),
  ...repeat({ os: "linux", deviceType: "desktop" }, 2),
  ...repeat({ os: "linux", deviceType: "workstation" }, 1),
  ...repeat({ os: "linux", deviceType: "server" }, 3)
];

const remainingTasks = [
  ...repeat("chat-llm", 10),
  ...repeat("coding-llm", 8),
  ...repeat("image-generation", 4),
  ...repeat("speech-to-text", 6),
  ...repeat("embeddings", 4)
];

const remainingDeployments = [
  ...repeat("local-only", 8),
  ...repeat("local-first", 18),
  ...repeat("cloud-ok", 6)
];

const remainingLanguages = [
  ...repeat("en", 18),
  ...repeat("zh-CN", 7),
  ...repeat("zh-TW", 4),
  ...repeat("mixed", 3)
];

const remainingScenarios = [
  ...repeat("clean", 19),
  ...repeat("messy", 7),
  ...repeat("adversarial", 6)
];

const remainingEntries = [
  ...repeat("paste", 24),
  ...repeat("manual", 5),
  ...repeat("preset-edit", 3)
];

const remainingTiers = [
  ...repeat("entry", 8),
  ...repeat("mainstream", 14),
  ...repeat("performance", 8),
  ...repeat("extreme", 2)
];

const taskPhrases = {
  en: {
    "chat-llm": "chat and writing assistant",
    "coding-llm": "coding assistant",
    "image-generation": "image generation with Stable Diffusion",
    "speech-to-text": "speech-to-text transcription",
    embeddings: "RAG and semantic search"
  },
  "zh-CN": {
    "chat-llm": "聊天写作助手",
    "coding-llm": "编程助手",
    "image-generation": "Stable Diffusion 图像生成",
    "speech-to-text": "语音转文字",
    embeddings: "RAG 向量搜索"
  },
  "zh-TW": {
    "chat-llm": "聊天寫作助手",
    "coding-llm": "編程助手",
    "image-generation": "Stable Diffusion 圖像生成",
    "speech-to-text": "語音轉文字",
    embeddings: "RAG 向量搜索"
  },
  mixed: {
    "chat-llm": "chat / 写作助手",
    "coding-llm": "coding / 編程助手",
    "image-generation": "Stable Diffusion / 图像生成",
    "speech-to-text": "transcription / 語音轉文字",
    embeddings: "RAG / 向量 search"
  }
};

const deviceLabels = {
  en: { laptop: "laptop", desktop: "desktop PC", workstation: "workstation", server: "server" },
  "zh-CN": { laptop: "笔记本", desktop: "台式机", workstation: "工作站", server: "服务器" },
  "zh-TW": { laptop: "筆電", desktop: "台式電腦", workstation: "工作站", server: "伺服器" },
  mixed: { laptop: "laptop 笔记本", desktop: "desktop 台式机", workstation: "workstation 工作站", server: "server 服务器" }
};

const osLabels = { windows: "Windows", macos: "macOS", linux: "Linux" };

function chooseWorkload(task, tier) {
  if (tier === "extreme") return task === "image-generation" ? "quality" : "production";
  if (task === "speech-to-text") return tier === "entry" ? "casual" : "batch";
  if (task === "embeddings") return tier === "entry" ? "casual" : "daily";
  if (task === "image-generation") return tier === "entry" ? "casual" : "quality";
  return tier === "entry" ? "casual" : "daily";
}

function choosePriorities(task, deployment, tier) {
  const values = new Set();
  if (deployment !== "cloud-ok") values.add("privacy");
  if (["coding-llm", "image-generation"].includes(task)) values.add("quality");
  if (task === "speech-to-text") values.add("speed");
  if (task === "embeddings") values.add("low-cost");
  if (tier === "entry") values.add("low-hardware");
  if (!values.size) values.add("ease");
  return [...values].slice(0, 3);
}

function buildHardware({ os, deviceType, task, deployment, hardwareTier }, salt) {
  const tierIndex = ["entry", "mainstream", "performance", "extreme"].indexOf(hardwareTier);
  const storageByTier = [128, 256, 512, 1024];
  const ramByTier = [8, 16, 32, 64];
  let cpuModel;
  let gpuVendor;
  let gpuModel;
  let ram = ramByTier[tierIndex];
  let vram;

  if (os === "macos") {
    const chips = [
      ["Apple M1", "Apple M2", "Apple M3", "Apple M4", "Apple M1 Pro"],
      ["Apple M1 Pro", "Apple M2 Pro", "Apple M3", "Apple M3 Pro", "Apple M4 Pro"],
      ["Apple M1 Max", "Apple M2 Max", "Apple M3 Pro", "Apple M3 Max", "Apple M4 Pro"],
      ["Apple M1 Ultra", "Apple M2 Ultra", "Apple M3 Max", "Apple M4 Max", "Apple M2 Max"]
    ];
    cpuModel = chips[tierIndex][salt % chips[tierIndex].length];
    gpuVendor = "apple";
    gpuModel = `${cpuModel} GPU`;
    vram = Math.max(4, Math.floor(ram * 0.75));
  } else {
    const cpuOptions = deviceType === "laptop" ? [
      ["Intel Core i3-1215U", "AMD Ryzen 3 7320U", "Intel Core i3-1115G4", "AMD Ryzen 3 5300U", "Intel Core i3-1315U"],
      ["Intel Core i5-1240P", "AMD Ryzen 5 7640HS", "Intel Core i5-1340P", "AMD Ryzen 5 6600U", "Intel Core i5-13500H"],
      ["Intel Core i7-13700H", "AMD Ryzen 7 7840HS", "Intel Core i7-1360P", "AMD Ryzen 7 6800H", "Intel Core i7-13800H"],
      ["Intel Core i9-13980HX", "AMD Ryzen 9 7945HX", "Intel Core i9-14900HX", "AMD Ryzen 9 7845HX", "Intel Core i9-12900HX"]
    ] : deviceType === "server" ? [
      ["Xeon E-2336", "AMD EPYC 7232P", "Xeon E-2324G", "AMD EPYC 7252", "Xeon E-2374G"],
      ["Xeon W-2245", "AMD EPYC 7313P", "Xeon Silver 4310", "AMD EPYC 7282", "Xeon W-2265"],
      ["Xeon Gold 6330", "AMD EPYC 7443P", "Xeon Gold 5318Y", "AMD EPYC 7413", "Xeon W-3375"],
      ["Xeon Platinum 8480", "AMD EPYC 9654", "Threadripper 7995WX", "AMD EPYC 9754", "Xeon Platinum 8490H"]
    ] : [
      ["Intel Core i3-12100", "AMD Ryzen 3 5300G", "Intel Core i3-13100", "AMD Ryzen 3 4100", "Intel Core i3-10100"],
      ["Intel Core i5-12400", "AMD Ryzen 5 7600", "Intel Core i5-13400", "AMD Ryzen 5 5600X", "Intel Core i5-12600K"],
      ["Intel Core i7-13700K", "AMD Ryzen 7 7800X3D", "Intel Core i7-12700K", "AMD Ryzen 7 7700X", "Intel Core i7-14700K"],
      ["Intel Core i9-13900K", "AMD Ryzen 9 7950X", "Intel Core i9-14900K", "AMD Ryzen 9 7900X", "Threadripper 7970X"]
    ];
    cpuModel = cpuOptions[tierIndex][salt % cpuOptions[tierIndex].length];

    const gpuOptions = deviceType === "laptop" ? [
      [["none", "No dedicated GPU", 0], ["intel", "Intel Iris Xe", 2]],
      [["nvidia", "NVIDIA RTX 4050 Laptop GPU", 6], ["nvidia", "NVIDIA RTX 4060 Laptop GPU", 8], ["intel", "Intel Arc A550M", 8]],
      [["nvidia", "NVIDIA RTX 4070 Laptop GPU", 8], ["nvidia", "NVIDIA RTX 4080 Laptop GPU", 12]],
      [["nvidia", "NVIDIA RTX 4090 Laptop GPU", 16], ["nvidia", "NVIDIA RTX 4080 Laptop GPU", 12]]
    ] : deviceType === "server" ? [
      [["none", "No dedicated GPU", 0]],
      [["nvidia", "NVIDIA RTX 3060", 12]],
      [["nvidia", "NVIDIA RTX 4070", 12], ["nvidia", "NVIDIA RTX 4080", 16]],
      [["nvidia", "NVIDIA RTX 4090", 24], ["nvidia", "NVIDIA RTX 3090", 24]]
    ] : [
      [["none", "No dedicated GPU", 0], ["intel", "Intel Iris Xe", 2], ["intel", "Intel Arc A380", 6]],
      [["nvidia", "NVIDIA RTX 3060", 8], ["amd", "AMD Radeon RX 6600", 8], ["intel", "Intel Arc A750", 8]],
      [["nvidia", "NVIDIA RTX 4070", 12], ["amd", "AMD Radeon RX 7800 XT", 16], ["nvidia", "NVIDIA RTX 3080", 10]],
      [["nvidia", "NVIDIA RTX 4090", 24], ["amd", "AMD Radeon RX 7900 XT", 20], ["nvidia", "NVIDIA RTX 3090", 24]]
    ];
    [gpuVendor, gpuModel, vram] = gpuOptions[tierIndex][salt % gpuOptions[tierIndex].length];
  }

  return {
    os,
    deviceType,
    cpuModel,
    gpuVendor,
    gpuModel,
    ram,
    vram,
    storage: storageByTier[tierIndex],
    internet: deployment === "cloud-ok" ? "available" : deployment === "local-only" ? "offline" : salt % 2 ? "available" : "setup-only",
    deployment,
    task,
    workload: chooseWorkload(task, hardwareTier),
    priorities: choosePriorities(task, deployment, hardwareTier)
  };
}

function gpuText(profile, languageStyle) {
  if (profile.gpuVendor === "apple") return "";
  if (profile.gpuVendor === "none") {
    if (languageStyle === "zh-CN") return "无独立显卡";
    if (languageStyle === "zh-TW") return "無獨立顯卡";
    return "no dedicated GPU";
  }
  if (languageStyle === "zh-CN") return `${profile.gpuModel} 显卡，${profile.vram}GB 显存`;
  if (languageStyle === "zh-TW") return `${profile.gpuModel} 顯示卡，${profile.vram}GB 顯存`;
  return `${profile.gpuModel} with ${profile.vram}GB VRAM`;
}

function baseText(profile, languageStyle, scenarioClass) {
  const os = osLabels[profile.os];
  const device = deviceLabels[languageStyle][profile.deviceType];
  const task = taskPhrases[languageStyle][profile.task];
  const apple = profile.gpuVendor === "apple";
  const gpu = gpuText(profile, languageStyle);
  const variant = (profile.cpuModel.length + profile.ram + profile.storage) % 3;

  if (languageStyle === "zh-CN") {
    const memory = apple ? `${profile.ram}GB 统一内存` : `${profile.ram}GB 内存`;
    if (scenarioClass === "messy") {
      if (variant === 0) return `我的电脑是 ${os} ${device}，处理器 ${profile.cpuModel}，内存大概 ${profile.ram}GB，${gpu || "Apple 集成 GPU"}，硬盘还剩 ${profile.storage}GB，主要想跑${task}`;
      if (variant === 1) return `配置单\n${profile.cpuModel}\n${gpu || "Apple GPU / 统一内存"}\nRAM：${profile.ram}GB\nSSD 可用：${profile.storage}GB\n用途：${task}\n系统：${os} ${device}`;
      return `整机清单｜用途：${task}；硬盘 ${profile.storage}GB；${gpu || `${profile.cpuModel} GPU`}；内存 ${profile.ram}GB；处理器 ${profile.cpuModel}；${os} ${device}`;
    }
    return `${os} ${device}，${profile.cpuModel}，${memory}${gpu ? `，${gpu}` : ""}，${profile.storage}GB 固态硬盘，用于${task}`;
  }

  if (languageStyle === "zh-TW") {
    const memory = apple ? `${profile.ram}GB 統一記憶體` : `${profile.ram}GB 記憶體`;
    if (scenarioClass === "messy") {
      if (variant === 0) return `我的電腦是 ${os} ${device}，處理器 ${profile.cpuModel}，記憶體大約 ${profile.ram}GB，${gpu || "Apple 整合 GPU"}，硬碟剩 ${profile.storage}GB，主要要跑${task}`;
      if (variant === 1) return `規格貼上\n${profile.cpuModel}\n${gpu || "Apple GPU / 統一記憶體"}\nRAM：${profile.ram}GB\nSSD 可用：${profile.storage}GB\n用途：${task}\n系統：${os} ${device}`;
      return `電腦規格｜用途：${task}；硬碟 ${profile.storage}GB；${gpu || `${profile.cpuModel} GPU`}；記憶體 ${profile.ram}GB；處理器 ${profile.cpuModel}；${os} ${device}`;
    }
    return `${os} ${device}，${profile.cpuModel}，${memory}${gpu ? `，${gpu}` : ""}，${profile.storage}GB 固態硬碟，用於${task}`;
  }

  if (languageStyle === "mixed") {
    const memory = apple ? `unified memory ${profile.ram}GB` : `RAM ${profile.ram}GB`;
    if (scenarioClass === "messy" && variant === 0) return `my setup / 我的配置: ${os} ${device}, cpu 是 ${profile.cpuModel}, ${memory}, ${gpu || "Apple GPU"}, disk free ${profile.storage}GB. want ${task}`;
    if (scenarioClass === "messy" && variant === 1) return `spec dump\nCPU ${profile.cpuModel}\n${gpu || "Apple GPU"}\n${memory}\nSSD free ${profile.storage}GB\n${os} ${device}\n用途 ${task}`;
    return `shopping list / 电脑配置 -> task: ${task} | SSD ${profile.storage}GB | ${gpu || `${profile.cpuModel} GPU`} | ${memory} | CPU ${profile.cpuModel} | ${os} ${device}`;
  }

  const memory = apple ? `${profile.ram}GB unified memory` : `${profile.ram}GB RAM`;
  if (scenarioClass === "messy") {
    if (variant === 0) return `My ${device} runs ${os}. It has a ${profile.cpuModel}, about ${profile.ram} gigs of memory, ${gpu || "Apple integrated graphics"}, and ${profile.storage}GB free on the SSD. I need ${task}.`;
    if (variant === 1) return `spec dump\nCPU ${profile.cpuModel}\n${gpu || "Apple GPU / shared memory"}\nRAM: ${profile.ram}GB\nSSD free: ${profile.storage}GB\n${os} ${device}\nuse: ${task}`;
    return `shopping list -> use: ${task} / SSD ${profile.storage}GB / ${gpu || `${profile.cpuModel} GPU`} / RAM ${profile.ram}GB / CPU ${profile.cpuModel} / ${os} ${device}`;
  }
  return `${os} ${device}, ${profile.cpuModel}, ${memory}${gpu ? `, ${gpu}` : ""}, ${profile.storage}GB SSD, for ${task}`;
}

function adversarialText(profile, languageStyle, kind) {
  if (kind === "unknown-cpu") {
    return baseText(profile, languageStyle, "messy");
  }
  if (kind === "unknown-gpu") {
    return baseText(profile, languageStyle, "messy");
  }
  if (kind === "omitted-memory") {
    const os = osLabels[profile.os];
    const device = deviceLabels[languageStyle][profile.deviceType];
    const task = taskPhrases[languageStyle][profile.task];
    if (languageStyle === "zh-CN") return `${os} ${device}，处理器 ${profile.cpuModel}，用途 ${task}；内存、显存和硬盘容量没写`;
    if (languageStyle === "zh-TW") return `${os} ${device}，處理器 ${profile.cpuModel}，用途 ${task}；記憶體、顯存和硬碟容量未填`;
    return `${os} ${device}; CPU ${profile.cpuModel}; use: ${task}; RAM, VRAM and storage were not listed`;
  }
  if (kind === "core-ultra") {
    return baseText({ ...profile, cpuModel: "Intel Core Ultra 7 155H" }, languageStyle, "clean");
  }
  const base = baseText(profile, languageStyle, "clean");
  if (languageStyle === "zh-CN") return `${base}。旧备注又写着 4GB 内存和 64GB 显存，请核对冲突。`;
  if (languageStyle === "zh-TW") return `${base}。舊備註又寫著 4GB 記憶體和 64GB 顯存，請核對衝突。`;
  return `${base}. An old note also says 4GB RAM and 64GB VRAM; values conflict.`;
}

function parserExpectation(profile, adversarialKind = null) {
  const ambiguousFields = [];
  const allowedInferredFields = [];
  const fields = {
    os: profile.os,
    deviceType: profile.deviceType,
    cpuModel: profile.cpuModel,
    ram: profile.ram,
    storage: profile.storage,
    task: profile.task
  };

  if (profile.gpuVendor === "apple") {
    allowedInferredFields.push("gpuVendor", "gpuModel", "vram");
  } else {
    fields.gpuVendor = profile.gpuVendor;
    fields.gpuModel = profile.gpuModel;
    fields.vram = profile.vram;
  }

  if (["contradiction-a", "contradiction-b"].includes(adversarialKind)) {
    ambiguousFields.push("ram", "vram");
  }
  if (adversarialKind === "unknown-cpu") ambiguousFields.push("cpuModel");
  if (adversarialKind === "unknown-gpu") ambiguousFields.push("gpuVendor", "gpuModel");
  if (adversarialKind === "omitted-memory") ambiguousFields.push("ram", "vram", "storage");

  ambiguousFields.forEach((field) => delete fields[field]);
  const filteredAllowedInferences = allowedInferredFields.filter((field) => !ambiguousFields.includes(field));
  return {
    fields,
    ambiguousFields,
    allowedInferredFields: filteredAllowedInferences,
    shouldWarn: ["contradiction-a", "contradiction-b", "unknown-cpu", "unknown-gpu", "omitted-memory"].includes(adversarialKind)
  };
}

function policyExpectation(profile) {
  const weakByTask = {
    "chat-llm": profile.ram < 8,
    "coding-llm": profile.ram < 8,
    "image-generation": profile.ram < 12 || profile.vram < 6 || ["none", "intel"].includes(profile.gpuVendor),
    "speech-to-text": profile.ram < 8,
    embeddings: profile.ram < 4
  };
  return {
    localOnly: profile.deployment === "local-only",
    cloudAllowed: profile.deployment !== "local-only",
    gpuRequiredTask: profile.task === "image-generation",
    weakHardwareExpected: weakByTask[profile.task]
  };
}

function journey(entryMode) {
  const taskSelection = entryMode === "paste" ? "detected" : "manual";
  const actions = entryMode === "paste"
    ? ["paste setup", "scan", "review", "apply", "confirm", "select task", "request recommendation"]
    : entryMode === "preset-edit"
      ? ["choose preset", "edit exact fields", "confirm", "select task", "request recommendation"]
      : ["open exact fields", "enter hardware", "confirm", "select task", "request recommendation"];
  return { entryMode, actions, taskSelection, requiresCorrection: entryMode !== "paste" };
}

function createRecord(slot, fold, position, adversarialKind = null) {
  let profile = slot.profile ? clone(slot.profile) : buildHardware(slot, fold * 100 + position);
  if (adversarialKind === "unknown-cpu") {
    profile.cpuModel = profile.deviceType === "laptop" ? "NovaCore NX-17H"
      : profile.deviceType === "server" ? "NovaCore Server NX-17"
        : "NovaCore NX-17";
  }
  if (adversarialKind === "unknown-gpu") {
    profile.gpuVendor = "nvidia";
    profile.gpuModel = profile.deviceType === "laptop" ? "NVIDIA MysteryGPU Z-10 Laptop GPU" : "NVIDIA MysteryGPU Z-10";
  }
  if (adversarialKind === "core-ultra") profile.cpuModel = "Intel Core Ultra 7 155H";

  const setupText = adversarialKind
    ? adversarialText(profile, slot.languageStyle, adversarialKind)
    : baseText(profile, slot.languageStyle, slot.scenarioClass);

  return {
    id: `user-${String((fold - 1) * 40 + position + 1).padStart(3, "0")}`,
    seed: SEED,
    fold,
    languageStyle: slot.languageStyle,
    scenarioClass: slot.scenarioClass,
    adversarialKind,
    hardwareTier: slot.hardwareTier,
    equivalenceGroup: slot.equivalenceGroup || null,
    setupText,
    profile,
    journey: { ...journey(slot.entryMode), requiresCorrection: slot.entryMode !== "paste" || Boolean(adversarialKind) },
    parserExpected: parserExpectation(profile, adversarialKind),
    policyExpected: policyExpectation(profile)
  };
}

const records = [];

for (let fold = 1; fold <= 5; fold += 1) {
  const foldSlots = [];

  pairTemplates.forEach((template, pairIndex) => {
    const profile = buildHardware(template, fold * 7 + pairIndex);
    pairPresentation[pairIndex].forEach((presentation) => {
      foldSlots.push({
        ...template,
        ...presentation,
        profile,
        equivalenceGroup: `fold-${fold}-pair-${pairIndex + 1}`,
        entryMode: "paste"
      });
    });
  });

  const joints = shuffle(remainingJointDevices);
  const tasks = shuffle(remainingTasks);
  const deployments = shuffle(remainingDeployments);
  const languages = shuffle(remainingLanguages);
  const scenarios = shuffle(remainingScenarios);
  const entries = shuffle(remainingEntries);
  const tiers = shuffle(remainingTiers);

  for (let index = 0; index < 32; index += 1) {
    foldSlots.push({
      ...joints[index],
      task: tasks[index],
      deployment: deployments[index],
      languageStyle: languages[index],
      scenarioClass: scenarios[index],
      entryMode: entries[index],
      hardwareTier: tiers[index],
      equivalenceGroup: null
    });
  }

  const adversarialKinds = shuffle(["contradiction-a", "contradiction-b", "unknown-cpu", "unknown-gpu", "omitted-memory", "core-ultra"]);
  let adversarialIndex = 0;
  foldSlots.forEach((slot, position) => {
    const kind = slot.scenarioClass === "adversarial" ? adversarialKinds[adversarialIndex++] : null;
    records.push(createRecord(slot, fold, position, kind));
  });
}

const dataset = {
  metadata: {
    name: "Model Digger synthetic user journey validation dataset",
    schemaVersion: "2.0",
    seed: SEED,
    count: records.length,
    folds: 5,
    assumptions: [
      "Traffic mix is a declared product assumption, not observed production behavior.",
      "Hardware profiles are synthetic and contain no personal data.",
      "Expected scanner labels were produced from the fixture specification, not Model Digger output."
    ]
  },
  records
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Wrote ${records.length} records to ${OUTPUT}`);
