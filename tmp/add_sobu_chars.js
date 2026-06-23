const fs = require('fs');
const path = require('path');

// Characters from encyclopedia + key 总武高 chars from knowledge
const newChars = [
  // === From Encyclopedia ===
  {
    name: '诺诺亚', source: '2.5次元的诱惑', base_age: 16, gender: 'female',
    appearance_brief: '浅红褐色短发鲍伯头、红褐色眼睛。娇小纤细，因长期室内活动而皮肤苍白。Cosplay时戴水蓝色假发。',
    hair_color: '浅红褐色', hair_style: '及肩鲍伯头', eye_color: '红褐色',
    outfits: {
      school: { top: '总武高制服外套', bottom: '过膝制服裙', desc: '规矩的高中制服，扣子扣到最上面，裙子比辣妹们长很多。' },
      cosplay: { desc: '诺基艾露Cos：黑深蓝色堕天使战斗服，与莉莉艾露成对立的暗色系造型。' }
    },
    body: { height_cm: 154, build: '纤细', cup: 'A', skin: { base_tone: '苍白', tan: 2, texture: '细腻' } },
    attributes: { '力量': 2, '敏捷': 3, '体质': 3, '智力': 7, '感知': 8, '魅力': 12 },
    skills: { '手工': 6, '口才': 2 },
    personality_brief: '表面是漫展著名的「冰之美少女」——面无表情眼神冷冽。真相是重度社恐：一紧张表情肌就坏死，内心在疯狂尖叫救命。网络上极其健谈（键盘侠褒义版），现实中说话细若蚊蝇。理利沙的狂热粉丝，为接近偶像拼命克服社恐。父亲是《阿什福德战记》作者日枯阳一。',
    personality_stages: { '6': '安静内向的小女孩，父母离异后和父亲生活。', '12': '社恐日益严重，在学校是透明人。在网络和SNS上找到了表达自己的方式——网上很健谈。', '16': '加入漫研社。第一次Cosplay时因紧张面无表情，意外被粉丝称为冰之美少女。社恐依旧但为了理利沙拼命努力。SNS上活泼调皮，现实里说话不超过半句。' },
    speech_style: '现实中：「那、那个……」「是……」声音细小，经常说半句就断掉。网络/内心：语速极快吐槽精准，大量感叹号和颜文字。Cosplay状态：努力维持高冷少言。',
    anchors: {
      emotional: '重度社恐——与人面对面交流时表情肌会坏死。但在网络中是个话唠，吐槽精准妙语连珠。对理利沙的崇拜近乎信仰——她是她的天使。为接近偶像会爆发出惊人的勇气。渴望友情和接纳，只是嘴巴不配合。',
      intimate: '对理利沙有超越友情的深厚感情——她是拯救自己灰暗世界的天使。被夸奖时会脸红到脖子但表情依然维持高冷（其实是僵住了）。在网络中会大胆表达喜爱，现实中只会默默为理利沙做最好的Cos服。',
      private: '父母离异，父亲是知名漫画家日枯阳一（对外保密）。从小在漫画的世界里找到慰藉。现实中几乎没有朋友，漫研社是她的第一个容身之所。智能手机绝对不离手——那是她和世界连接的窗口。'
    },
    likes: ['天乃理利沙（天使）', '阿什福德战记', 'Cosplay', 'SNS', '父亲的漫画'],
    dislikes: ['现实中的人际交往', '被人盯着看', '自己的怯懦', '过于刺眼的热情'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' },
    schedule_group: '高校生', funds: 3000, sex_profile: '诺诺亚'
  },
  {
    name: '喜咲亚理亚', source: '2.5次元的诱惑', base_age: 16, gender: 'female',
    appearance_brief: '亮金色双马尾、翠绿色眼睛。辣妹风格，娇小纤细贫乳，健康肤色。书包挂满叮当响的挂件。',
    hair_color: '亮金色', hair_style: '双马尾/编辫子', eye_color: '翠绿色',
    outfits: {
      school: { top: '衬衫（领口大开）+ 鲜艳吊带背心', bottom: '超短改版百褶裙', acc: '耳机、多个手环、挂件', desc: '标准辣妹风——领口大开内搭鲜艳吊带，超短百褶裙，脖子上挂耳机手腕多个手环。' }
    },
    body: { height_cm: 153, build: '纤细', cup: 'A', skin: { base_tone: '健康小麦', tan: 8, texture: '细腻' } },
    attributes: { '力量': 3, '敏捷': 5, '体质': 4, '智力': 5, '感知': 12, '魅力': 16 },
    skills: { '口才': 9, '运动': 4 },
    personality_brief: '典型现代辣妹——说话大声自来熟，情绪永远高涨，辣妹用语轰炸。但拥有极高的情商和观察力，能敏锐察觉他人情绪并给予恰到好处的安慰。内心细腻害怕寂寞，父亲早逝让她渴望家庭般的温暖，极度珍惜漫研社的羁绊。Cosplay时擅长捕捉角色的心和情感，用演技感染观众。完全不会做衣服——手残党。',
    personality_stages: { '6': '活泼好动的小女孩，喜欢可爱的东西。父亲还在世时是最幸福的时光。', '12': '父亲早逝后开始用开朗外表掩盖内心的孤独。逐渐发展出辣妹风格——这是她的盔甲也是她的表达。', '16': '加入漫研社找到了第二个家。社团的对外公关担当，气氛制造者。Cosplay虽不会做衣服但演技一流。看似大大咧咧实则最怕被抛弃。' },
    speech_style: '辣妹用语轰炸：「真的假的」「超搞笑的」「～系」「～笑(w)」。语调上扬充满活力。称呼奥村为阿宅君或前辈，语气亲昵。句尾加大量语气词。直率但不失礼貌——情商高到不会真的冒犯人。',
    anchors: {
      emotional: '外表是没心没肺的辣妹，内核是怕寂寞的小女孩。父亲早逝后渴望家庭般的温暖——漫研社就是她的第二个家。情商极高，总能在气氛尴尬时精准救场，在朋友低落时给出最合适的安慰。笑最大声的人往往最怕安静。',
      intimate: '对漫研社的每个人都真心以待。害怕被抛弃所以拼命做气氛制造者——觉得自己必须有用才值得被留下。大大咧咧的外表下藏着细腻的内心。被认真对待时会突然安静下来——那是她卸下盔甲的罕见时刻。',
      private: '父亲早逝是人生的分水岭。从那以后学会了用笑声填补沉默。家里不富裕但从不抱怨——靠自己打工维持辣妹风格的开销。不喜欢学习但喜欢少年漫画——意外的反差。做Cosplay时最认真——那是她为数不多卸下辣妹面具的时刻。'
    },
    likes: ['聊天/社交', '可爱的东西', '漫研社的大家', '少年漫画', 'Cosplay演技'],
    dislikes: ['复杂的文字/学习', '孤独', '沉闷的气氛', '虫子（但为朋友敢于驱赶）'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' },
    schedule_group: '高校生', funds: 2000, sex_profile: '喜咲亚理亚'
  },
  {
    name: '和泉幽希', source: '式守同学不只可爱', base_age: 16, gender: 'male',
    appearance_brief: '外表普通的男高中生，身体柔弱。学习成绩前十，女子力很高。',
    hair_color: '黑色', hair_style: '短发', eye_color: '黑色',
    outfits: { school: { top: '总武高制服', bottom: '制服裤', desc: '标准总武高男生制服。' } },
    body: { height_cm: 168, build: '瘦弱', skin: { base_tone: '普通', tan: 5, texture: '普通' } },
    attributes: { '力量': 2, '敏捷': 3, '体质': 3, '智力': 9, '感知': 10, '魅力': 11 },
    skills: { '学习': 8, '手工': 7, '口才': 4 },
    personality_brief: '式守都的男朋友。学习成绩前十但身体柔弱。女子力极高——厨艺出色能做好大部分料理和甜点。性格温柔善良，近期时常想在式守面前展现男子汉的一面但进展不顺利，立场经常反过来——被女友帅气的保护。好朋友犬束秀私底下和式守关系暧昧让他有点在意。',
    personality_stages: { '6': '温和安静的小男孩，从小就比较柔弱。', '12': '学习成绩开始突出。不擅长运动但性格温柔人缘不错。', '16': '和式守都交往中。虽然想展现男子汉气概但总是被女友帅气地保护。厨艺和家务能力一流——是女朋友的专属厨师。' },
    speech_style: '语气温和有礼，稍微有点缺乏自信。对式守说话时会更柔软甚至有点撒娇。和朋友（犬束）说话更随意。被女友帅到时会小声嘟囔。',
    anchors: {
      emotional: '外表柔弱的普通男高中生，但有一颗想要保护女友的真心。女子力高到令人羡慕——厨艺家务全能。在式守面前时常角色反转：想当王子结果自己变成了公主。不介意女友比自己强，但偶尔也想被她依靠。',
      intimate: '对式守的感情真诚而温柔。知道她喜欢可爱的东西，会努力配合她的节奏。吃醋时不会大吵大闹——而是默默做更好吃的甜点。被式守保护时心里又甜又酸。犬束和式守的暧昧关系是他心中一根小小的刺。',
      private: '从小身体不好所以学会了照顾自己——厨艺就是这么练出来的。学习成绩好但不爱炫耀。朋友们都说他找个那么帅的女朋友简直是上辈子拯救了地球——他认真地觉得这句话是对的。'
    },
    likes: ['料理', '甜点制作', '和式守在一起', '平静的日常'], dislikes: ['自己的柔弱', '无法保护式守时', '运动（不擅长）'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' },
    schedule_group: '高校生', funds: 2000
  },
  // === Key 春物 missing (appear in main story) ===
  {
    name: '城廻巡', source: '我的青春恋爱物语果然有问题。', base_age: 17, gender: 'female',
    appearance_brief: '黑色中长发，温柔优雅的学姐。前学生会长，举止端庄。',
    hair_color: '黑色', hair_style: '中长发', eye_color: '棕色',
    outfits: { school: { top: '总武高制服外套', bottom: '黑白百褶裙', desc: '标准总武高女生制服。' } },
    body: { height_cm: 160, build: '匀称', skin: { base_tone: '白皙', tan: 5, texture: '细腻' } },
    attributes: { '力量': 3, '敏捷': 4, '体质': 4, '智力': 11, '感知': 13, '魅力': 15 },
    skills: { '口才': 8, '学习': 7 },
    personality_brief: '总武高前学生会长。温柔优雅的学姐，处事圆滑周到，在学生会交接中展现出色的协调能力。对一色彩羽既是前辈也是引导者——以退为进的方式让一色在学生会中成长。看似轻飘飘的温柔，实则有敏锐的洞察力和不动声色的决断力。',
    personality_stages: { '6': '乖巧懂事的小女孩。', '12': '开始展现出领导力和协调能力。', '17': '总武高学生会长→前会长。将学生会交接给一色彩羽的过程展现了她的成熟和智慧。' },
    speech_style: '语气温柔有礼，带有学姐的从容。喜欢用柔和的语调表达明确的态度——是真正的以柔克刚。',
    anchors: {
      emotional: '温柔优雅的前学生会长。擅长以柔克刚——用最软的语调说出最坚定的态度。对后辈的引导不动声色但精准有效。是学生会里真正的大姐姐。',
      intimate: '私下里比公开场合更放松——会偶尔展露真正的大笑。对一色彩羽的关心超越了公事——看到她在学生会里手忙脚乱时会在暗处偷笑然后出手帮忙。',
      private: '毕业后将学生会交给了还不太成熟的一色——这个决定让很多人意外。但她在一色身上看到了她自己年轻时也有的光芒。'
    },
    likes: ['学生会工作', '红茶', '引导后辈'], dislikes: ['冲突', '不公正'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '15': '高校生', '18': '大学生' }, schedule_group: '高校生', funds: 5000
  },
  {
    name: '户部翔', source: '我的青春恋爱物语果然有问题。', base_age: 17, gender: 'male',
    appearance_brief: '茶色短发，叶山集团成员。性格开朗但不会察言观色。',
    hair_color: '茶色', hair_style: '短发', eye_color: '棕色',
    outfits: { school: { top: '总武高制服', bottom: '制服裤', desc: '标准总武高男生制服。' } },
    body: { height_cm: 172, build: '标准', skin: { base_tone: '普通', tan: 8, texture: '普通' } },
    attributes: { '力量': 5, '敏捷': 6, '体质': 5, '智力': 5, '感知': 4, '魅力': 10 },
    skills: { '运动': 6, '口才': 5 },
    personality_brief: '叶山集团的气氛制造者。开朗外向但极度不会读空气——在京都修学旅行中委托侍奉部帮他向海老名姬菜告白，引发了后续一系列事件。本质上是个善良单纯的人，只是不太聪明。足球部成员。',
    personality_stages: { '6': '活泼好动的小男孩。', '12': '开始踢足球，运动能力突出。', '17': '叶山集团成员。喜欢海老名姬菜——为此闹出了京都告白风波。' },
    speech_style: '说话大大咧咧音量偏大，经常不等对方说完就开始回应。不会读空气——这是他的标志也是他的可爱之处。',
    anchors: {
      emotional: '叶山集团的开心果。开朗单纯不会算计——但也因此经常踩到别人的雷区。真心喜欢海老名姬菜，即使被拒绝后也没有怨恨。本质是个好人只是脑子不太灵光。',
      intimate: '对海老名的喜欢是认真的——虽然表达方式笨拙到让整个侍奉部头疼。被拒绝后一度消沉但很快恢复——他就是这样的人。',
      private: '知道自己不太聪明。有时候会羡慕八幡那种看透一切的冷静，但做不来——也不想做。踢球的时候最快乐。'
    },
    likes: ['足球', '叶山集团', '海老名姬菜'], dislikes: ['复杂的思考', '被排除在外'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '15': '高校生', '18': '大学生' }, schedule_group: '高校生', funds: 3000
  },
  {
    name: '折本香织', source: '我的青春恋爱物语果然有问题。', base_age: 17, gender: 'female',
    appearance_brief: '棕色短发，活泼开朗。八幡的初中同班同学——他曾向她告白被拒。',
    hair_color: '棕色', hair_style: '短发', eye_color: '棕色',
    body: { height_cm: 156, build: '匀称', skin: { base_tone: '普通', tan: 8, texture: '普通' } },
    attributes: { '力量': 3, '敏捷': 5, '体质': 4, '智力': 6, '感知': 6, '魅力': 11 },
    skills: { '口才': 7, '运动': 4 },
    personality_brief: '八幡初中曾告白过的对象——被拒后八幡的黑历史之一。性格开朗直率，和任何人都能打成一片。高中在隔壁班偶尔打照面会让八幡尴尬到想死。对过去的事没有恶意——只是当时没那个感觉。某种程度上是八幡性格形成的关键人物。',
    personality_stages: { '12': '初中时是班上的人气女生。被八幡告白——拒绝了。', '17': '高中在总武高隔壁班。偶尔撞见八幡时会自然打招呼——完全没意识到对方有多尴尬。' },
    speech_style: '语气活泼自然，说话直来直去。和任何人都不设防——包括曾经向她告白过的八幡。',
    anchors: {
      emotional: '开朗直率的普通女高中生。曾经拒绝过八幡的告白——在当时的她看来只是普通的拒绝了一个不太熟的男生。完全不知道这件事对八幡造成了多大的心理阴影。没有恶意——只是太普通了。',
      private: '偶尔会想起初中那个向她告白的男生——印象中是个眼神像死鱼的奇怪家伙。不知道他现在怎么样了。'
    },
    likes: ['聊天', '朋友聚会'], dislikes: ['太沉重的话题'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '15': '高校生', '18': '大学生' }, schedule_group: '高校生', funds: 3000
  }
];

// Add sex profiles
const newSPs = {
  '诺诺亚': { baselineDesire: 20, attitude: '羞涩', experience: '未开发', female: { breast: { cup: 'A', shape: '水滴', nipple_size: '小', nipple_color: '淡粉', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 13, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '浅褐', style: '自然' }, clitoris: '隐藏' }, bodyParts: { '唇': { sensitivity: 5, development: 0, preference: '普通' }, '颈': { sensitivity: 6, development: 0, preference: '害羞' }, '胸': { sensitivity: 6, development: 0, preference: '害羞' }, '腰': { sensitivity: 4, development: 0, preference: '防御' }, '腿': { sensitivity: 4, development: 0, preference: '普通' }, '秘部': { sensitivity: 3, development: 0, preference: '防御' }, '肛': { sensitivity: 2, development: 0, preference: '排斥' } }, cycleDay: 20, climaxThreshold: 50, likes: ['被温柔引导', '安全私密的环境', '不说话只用行动表达'], dislikes: ['被注视', '太快的节奏', '被迫说话'] },
  '喜咲亚理亚': { baselineDesire: 45, attitude: '主动', experience: '未开发', female: { breast: { cup: 'A', shape: '水滴', nipple_size: '小', nipple_color: '粉色', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 13, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '金色', style: '剃除' }, clitoris: '普通' }, bodyParts: { '唇': { sensitivity: 7, development: 0, preference: '喜欢' }, '颈': { sensitivity: 6, development: 0, preference: '喜欢' }, '胸': { sensitivity: 7, development: 0, preference: '普通' }, '腰': { sensitivity: 6, development: 0, preference: '喜欢' }, '腿': { sensitivity: 6, development: 0, preference: '喜欢' }, '秘部': { sensitivity: 5, development: 0, preference: '普通' }, '肛': { sensitivity: 3, development: 0, preference: '排斥' } }, cycleDay: 14, climaxThreshold: 40, likes: ['被认真对待（会让她安静下来）', '欢乐的节奏', '被夸奖'], dislikes: ['沉闷', '被忽略', '太严肃的氛围'] }
};

const files = ['worldpacks/oregairu/characters.json', 'data/characters.json'];
for (const file of files) {
  const arr = JSON.parse(fs.readFileSync(path.resolve(file), 'utf-8'));
  for (const nc of newChars) {
    if (!arr.find(c => c.name === nc.name)) arr.push(nc);
  }
  fs.writeFileSync(path.resolve(file), JSON.stringify(arr, null, 2));
  console.log('Updated', file, '->', arr.length, 'chars');
}

const sp = JSON.parse(fs.readFileSync(path.resolve('data/sex_profiles.json'), 'utf-8'));
for (const [name, data] of Object.entries(newSPs)) {
  if (!sp[name]) sp[name] = data;
}
fs.writeFileSync(path.resolve('data/sex_profiles.json'), JSON.stringify(sp, null, 2));
console.log('Added', Object.keys(newSPs).length, 'sex profiles, total:', Object.keys(sp).length);
console.log('Done');
