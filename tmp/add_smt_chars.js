const fs = require('fs');
const path = require('path');

const newChars = [
  {
    name: '矶野上多绪', source: '原创', base_age: 17, gender: 'female',
    appearance_brief: '柔顺黑色长发、刘海整齐、双侧鬓发长及胸口、淡蓝色眼睛。身形修长，清纯温柔，充满亲和力。曾因发质太好被邀请拍洗发水广告。',
    hair_color: '黑色', hair_style: '长直（刘海整齐，鬓发及胸）', eye_color: '淡蓝色',
    body: { height_cm: 168, weight_kg: 54, build: '修长', cup: 'B', skin: { base_tone: '白皙', tan: 3, texture: '细腻' } },
    attributes: { '力量': 4, '敏捷': 5, '体质': 5, '智力': 10, '感知': 14, '魅力': 15 },
    skills: { '口才': 8, '运动': 6 },
    personality_brief: '思想保守生活开放的青梅竹马。轻声细语般温柔，善良活泼没有距离感，善于照顾他人和调解矛盾。极具领导才能但用的是包容而非命令。习惯往好的方向想事情，有时因过于理想化被说成「只讲漂亮话的天真派」。但这份温柔之下是对同伴的绝对忠诚——为了保护重要的人可以奋不顾身甚至牺牲自己。',
    personality_stages: {
      '6': '安静乖巧的小女孩，从小就喜欢照顾别人——帮同学整理东西、调解小朋友之间的吵架。',
      '12': '领导才能开始显现。温柔但坚定，习惯用调解而非对抗解决矛盾。对青梅竹马（玩家）格外照顾。',
      '16': '总武高二年生，袋棍球社成员。善于照顾他人的性格让她在班级里成为大家依赖的对象。但偶尔会流露出不符合年龄的略带烦恼的表情——她习惯把所有人的问题扛在自己肩上。对敌人（伤害她同伴的人）毫不留情，严肃且一丝不苟。'
    },
    speech_style: '敬语或礼貌体。多关怀式问句和鼓励性陈述句。高好感后更口语化随意，会撒娇展现脆弱的一面。调解矛盾时语气温和但立场坚定——不是和稀泥而是真的找到双方都能接受的方案。',
    anchors: {
      emotional: '表面温柔活泼没有距离感，善于照顾他人和调解矛盾。包容，习惯对现状妥协，只想好的一面。有时因过于理想化被说是天真派。但这份包容不是软弱——她只是选择用善意解读世界。一旦有人越过她的底线（伤害同伴），态度会瞬间转为冰冷严厉。',
      intimate: '在信任的人面前会放下完美调解人的面具。会撒娇，会展现脆弱，会抱怨那些她替别人扛着的烦恼。对玩家有青梅竹马的特殊依赖——在他面前可以不用总是做那个负责照顾所有人的人。高好感时会流露更多任性的一面。',
      private: '习惯把所有责任扛在自己身上。调解别人矛盾的同时自己内心也有不为人知的挣扎——对和平的渴望和对现实的无力感并存。有时候会想如果世界简单一点就好了，但又知道不简单的部分正是她存在的意义。妹妹是她最重要的亲人。'
    },
    likes: ['和平', '秩序', '朋友', '保护弱小', '调解矛盾'],
    dislikes: ['暴力', '混乱无序', '伤害同伴的人', '无法保护重要的人'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' },
    schedule_group: '高校生', funds: 3000, sex_profile: '矶野上多绪'
  },
  {
    name: '寻峰洋子', source: '原创', base_age: 18, gender: 'female',
    appearance_brief: '黑色短发发尾凌乱、斜刘海过眉、深红色赤瞳。眼神锐利眼角却有一丝妩媚感。身高166cm，体态端正有力量感，人群中突出。',
    hair_color: '黑色', hair_style: '短发（发尾凌乱，斜刘海）', eye_color: '深红色',
    body: { height_cm: 166, weight_kg: 52, build: '匀称有力量感', cup: 'C', skin: { base_tone: '白皙', tan: 3, texture: '细腻' } },
    attributes: { '力量': 6, '敏捷': 7, '体质': 6, '智力': 12, '感知': 14, '魅力': 15 },
    skills: { '口才': 9, '运动': 5 },
    personality_brief: '思想开放生活作风保守的酷美人。大胆直率，言行举止成熟带一丝慵懒，给人打破常规的优等生印象。被部分学生私下敬称为大姐头，却又习惯游离在各种群体外。防御性悲观主义——习惯只想坏的一面、把事物往坏的方向考虑，认为现在不改只会更糟。洞察本质但想法激进喜欢锐评。强烈的正义感和母性的共情，造就她冷酷的决断力和行动力。',
    personality_stages: {
      '6': '安静但已经展露出不符合年龄的洞察力的小女孩。喜欢阅读，尤其对宗教和神话相关的书籍有异于常人的兴趣。',
      '12': '正义感开始成形。看不惯欺负弱者的行为——会直接站出来。同学开始既敬畏又依赖她，但她习惯独来独往。',
      '16': '圣玛利亚女子学院二年生。被私下称为大姐头但游离群体外。说话锐利但一针见血——她的悲观主义不是消沉的而是行动导向的：正因为看到了最坏的可能，才必须现在就开始改变。对玩家初次接触时会俏皮wink，熟络后会产生惊人的默契和依赖。'
    },
    speech_style: '简洁明了富有逻辑。循循善诱，充满母性的引导感。标准用语带些微大小姐语气词。一般少用「我」或直接表达感情，给人柔韧有余的感觉，像政治家一样善于说服。高好感后流露女人味和依赖，会寻求认同和分享——语气从锐评切换成寻求默契的温柔。',
    anchors: {
      emotional: '大胆直率，外表冷酷内心慈悲。防御性悲观主义者——不是消极而是行动导向。洞察本质想法激进，喜欢一针见血的锐评。被私下叫大姐头但习惯游离在所有群体外面——她不属于任何圈子，她只站在需要她的人那边。',
      intimate: '对玩家有特殊的信任——熟络后会迅速产生多年夫妻般的默契，尤其是在交谈时。对此感到欣喜和精神依赖。最高好感时会流露出少女感——给他戴上项圈这种举动既是大胆的挑逗也是信任的象征：把最脆弱的部分交给他来掌控。会调侃玩家「是那种会突然一声不吭就抛弃原配妻子而去的类型呢」——这种带刺的温柔是她独有的表达方式。',
      private: '内心承载着远超同龄人的重量感和使命感。阅读宗教和魔法古籍不是中二病——是她在寻找这个世界的问题根源。她看到的总是最坏的可能性，但这份悲观不是用来消沉的而是用来战斗的。相信现在的秩序如果不被质疑和打破，只会变得更糟。这个世界上受压迫的人需要一个不妥协的声音——她决定成为那个声音。'
    },
    likes: ['真相', '保护受压迫者', '阅读（宗教/魔法古籍）', '直率的表达'],
    dislikes: ['压迫者', '支配者', '扭曲的秩序', '为维持秩序而产生的牺牲'],
    default_location: '千叶',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' },
    schedule_group: '高校生', funds: 4000, sex_profile: '寻峰洋子'
  }
];

const newSPs = {
  '矶野上多绪': {
    baselineDesire: 40, attitude: '顺从', experience: '未开发',
    female: { breast: { cup: 'B', shape: '水滴', nipple_size: '普通', nipple_color: '粉色', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 14, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '黑色', style: '自然' }, clitoris: '隐藏' },
    bodyParts: { '唇': { sensitivity: 6, development: 0, preference: '喜欢' }, '颈': { sensitivity: 7, development: 0, preference: '喜欢' }, '胸': { sensitivity: 6, development: 0, preference: '普通' }, '腰': { sensitivity: 5, development: 0, preference: '普通' }, '腿': { sensitivity: 5, development: 0, preference: '喜欢' }, '秘部': { sensitivity: 5, development: 0, preference: '普通' }, '肛': { sensitivity: 2, development: 0, preference: '排斥' } },
    cycleDay: 13, climaxThreshold: 42,
    likes: ['温柔的引导', '被需要的感觉', '耳边的低语'], dislikes: ['粗暴', '被忽视', '同伴受伤']
  },
  '寻峰洋子': {
    baselineDesire: 50, attitude: '主动', experience: '未开发',
    female: { breast: { cup: 'C', shape: '水滴', nipple_size: '普通', nipple_color: '粉色', areola_size: '普通', feel: '弹力' }, vagina: { type: '闭合', labia_size: '普通', depth_cm: 14, tightness: '紧致', inner_color: '玫瑰', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '黑色', style: '修剪' }, clitoris: '普通' },
    bodyParts: { '唇': { sensitivity: 7, development: 0, preference: '喜欢' }, '颈': { sensitivity: 8, development: 0, preference: '敏感' }, '胸': { sensitivity: 8, development: 0, preference: '喜欢' }, '腰': { sensitivity: 6, development: 0, preference: '普通' }, '腿': { sensitivity: 7, development: 0, preference: '喜欢' }, '秘部': { sensitivity: 6, development: 0, preference: '普通' }, '肛': { sensitivity: 3, development: 0, preference: '排斥' } },
    cycleDay: 8, climaxThreshold: 35,
    likes: ['掌控节奏', '眼神交流', '被戴上项圈（最高好感）', '默契的交谈'], dislikes: ['被支配', '虚伪', '不反抗的软弱']
  }
};

for (const file of ['data/characters.json', 'worldpacks/oregairu/characters.json']) {
  const arr = JSON.parse(fs.readFileSync(path.resolve(file), 'utf-8'));
  for (const nc of newChars) if (!arr.find(c => c.name === nc.name)) arr.push(nc);
  fs.writeFileSync(path.resolve(file), JSON.stringify(arr, null, 2));
  console.log(file, ':', arr.length, 'chars');
}
const sp = JSON.parse(fs.readFileSync('data/sex_profiles.json', 'utf-8'));
for (const [k, v] of Object.entries(newSPs)) if (!sp[k]) sp[k] = v;
fs.writeFileSync('data/sex_profiles.json', JSON.stringify(sp, null, 2));
console.log('Sex profiles:', Object.keys(sp).length);
console.log('Done');
