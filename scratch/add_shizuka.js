const fs = require('fs');
const path = require('path');

const charsPath = path.join(__dirname, '../data/characters.json');
let chars = JSON.parse(fs.readFileSync(charsPath, 'utf-8'));

chars = chars.filter(c => c.name !== '平冢静');

const shizuka = {
  name: "平冢静",
  source: "我的青春恋爱物语果然有问题。",
  base_age: 29,
  gender: "female",
  appearance_brief: "黑色长发，常穿白大褂和西装，身材丰满，透露着成熟大人的魅力与疲惫。",
  body: {
    height_cm: 168,
    weight_kg: 54,
    build: "匀称",
    measurements: { bust: 90, waist: 62, hips: 92 },
    cup: "E",
    leg_type: "修长",
    body_shape: { chest: "丰满", hips: "挺翘", waist: "适中" },
    skin: { base_tone: "自然", tan: 5, texture: "成熟" },
    diet: "随意", exercise: "偶尔锻炼"
  },
  body_by_age: {
    "6": { height_cm: 120, weight_kg: 22, build: "匀称", leg_type: "普通", diet: "正常", exercise: "正常", skin: { base_tone: "自然", tan: 10, texture: "娇嫩" }, measurements: { bust: 55, waist: 50, hips: 55 }, cup: "AA" },
    "12": { height_cm: 148, weight_kg: 40, build: "匀称", leg_type: "结实", diet: "正常", exercise: "多动", skin: { base_tone: "自然", tan: 15, texture: "活力" }, measurements: { bust: 72, waist: 55, hips: 75 }, cup: "B" },
    "16": { height_cm: 162, weight_kg: 50, build: "丰满", leg_type: "修长", diet: "正常", exercise: "正常", skin: { base_tone: "自然", tan: 5, texture: "细腻" }, measurements: { bust: 85, waist: 60, hips: 88 }, cup: "D" },
    "29": { height_cm: 168, weight_kg: 54, build: "丰满", leg_type: "修长", diet: "随意", exercise: "偶尔锻炼", skin: { base_tone: "自然", tan: 5, texture: "成熟" }, measurements: { bust: 90, waist: 62, hips: 92 }, cup: "E" }
  },
  attributes: { "力量": 14, "敏捷": 12, "体质": 12, "智力": 14, "感知": 14, "魅力": 16 },
  anchors: ["总武高_职员室", "千叶_餐厅"],
  schedule: [
    { start: "08:00", end: "12:00", location: "总武高_职员室", activity: "办公/备课" },
    { start: "12:00", end: "13:00", location: "总武高_食堂", activity: "午餐" },
    { start: "13:00", end: "17:00", location: "总武高_职员室", activity: "办公/处理问题学生" },
    { start: "17:00", end: "18:00", location: "总武高_侍奉部", activity: "巡视侍奉部" },
    { start: "18:00", end: "20:00", location: "千叶_餐厅", activity: "吃拉面" },
    { start: "20:00", end: "24:00", location: "千叶_住宅区", activity: "喝啤酒、看漫画" }
  ]
};

chars.push(shizuka);
fs.writeFileSync(charsPath, JSON.stringify(chars, null, 2), 'utf-8');

const stagesPath = path.join(__dirname, '../data/character_stages.json');
let stages = JSON.parse(fs.readFileSync(stagesPath, 'utf-8'));
stages["平冢静"] = [
  { "age": 6, "appearance": "调皮的小女孩，有些男孩子气。", "description": "还在上小学的平冢静，喜欢到处跑动。" },
  { "age": 12, "appearance": "初中生，留着黑色短发，充满活力。", "description": "处于叛逆期，对格斗技和漫画充满兴趣。" },
  { "age": 16, "appearance": "高中生，头发变长，身材发育丰满。", "description": "有些热血的高中女生，正义感强。" },
  { "age": 29, "appearance": "成熟的女性，常穿白大褂，眼神有些疲惫但充满成年人的魅力。", "description": "总武高的国语教师兼生活指导老师，因为催婚压力很大。" }
];
fs.writeFileSync(stagesPath, JSON.stringify(stages, null, 2), 'utf-8');

console.log("Done adding Hiratsuka Shizuka.");
