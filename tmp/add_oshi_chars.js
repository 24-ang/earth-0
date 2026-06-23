const fs = require('fs');
const path = require('path');

const newChars = [
  {
    name: '黑川茜', source: '我推的孩子', base_age: 17, gender: 'female',
    appearance_brief: '蓝紫色长发、蓝色大眼睛。外表纤细，体脂型身体，腰臀比明显，模特般的身材比例。',
    hair_color: '蓝紫色', hair_style: '长发', eye_color: '蓝色',
    body: { height_cm: 163, build: '纤细', cup: 'B', leg_type: '修长', skin: { base_tone: '白皙', tan: 3, texture: '细腻' } },
    attributes: { '力量': 3, '敏捷': 4, '体质': 4, '智力': 14, '感知': 16, '魅力': 15 },
    skills: { '口才': 8, '学习': 8 },
    personality_brief: '成熟认真的姐系演员。对家人朋友温柔体贴甚至有点母性包容，对外人冷淡。具有超强观察力和分析力——被称作"侦探"。演技精湛能完美演绎各种角色。渴望被爱和认可，缺乏安全感，有强烈的责任感容易为重要的人牺牲自我。曾在恋爱真人秀中被网络暴力逼到自杀边缘，被救后对救命恩人产生深厚感情。',
    personality_stages: {
      '6': '安静乖巧的女孩，因憧憬有马加奈加入紫阳花剧团开始演戏。',
      '12': '为了接近加奈模仿她的发型装扮。某次试镜被误认为加奈，开始思考演技的本质——不是模仿而是成为。',
      '17': '高中生兼LalaLai剧团演员。参与恋爱真人秀经历了从恶女角色到网络暴力到自杀未遂再到重生。被救后展开演艺生涯新篇章——在舞台剧《东京BLADE》中与有马加奈进行演技对决。发现了阿库亚的身世秘密并决定成为他的助力。在恋人面前化身小女友——会撒娇吃醋调情。'
    },
    speech_style: '敬语有礼貌，逻辑清晰条理分明。擅长反问和隐喻，语气坚定，有时会反讽。在熟人面前切换成温柔贴心模式，会注意对方感受和情绪。在恋人面前说话更软——适当的撒娇、吃醋（鼓起嘴巴）、调情，行为动作少女感十足。',
    anchors: {
      emotional: '成熟认真的演员，对家人朋友极度温柔体贴——几乎有母性包容。对外人冷淡，但在乎的人面前是完全不同的存在。渴望被爱和认可，缺乏安全感——她把自己逼得太紧，普通高中+演艺圈的双重压力让她在真人秀时代差点崩溃。对被救的恩人有深海般的忠诚和感情。',
      intimate: '在恋人面前化身小女友。会主动撒娇、吃醋（鼓起嘴巴）、调情，关注男友情绪，行为动作少女感十足。对恋情认真投入——确立了关系后会全心全意成为对方的助力。对R18话题在恋人面前会害羞但好奇。私下喜欢照顾对方——做饭整理家务。',
      private: '父亲是警察厅高层官僚，家庭氛围良好的中产以上家庭。普通高中就读——没有演艺圈同龄朋友的理解让她格外孤独。真人秀时期的网络暴力几乎摧毁了她——那个雨天她差点结束一切。被救后对救命恩人产生了超越感激的感情。在演技道路上与有马加奈既是竞争对手也是互相激励的同伴。发现了阿库亚的身世秘密——决定成为他的助力而不是揭露者。'
    },
    likes: ['演戏', '推理', '照顾家人朋友', '挑战高难度角色', '救命恩人'],
    dislikes: ['虚伪', '被人背叛', '不被理解', '网络暴力'],
    default_location: '阳东高中',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' },
    schedule_group: '高校生', funds: 5000, sex_profile: '黑川茜'
  },
  {
    name: '星野瑠美衣', source: '我推的孩子', base_age: 16, gender: 'female',
    appearance_brief: '金色及腰长发、粉红与红色渐变如宝石般闪耀的眼眸。心形脸，微笑时露出独特的虎牙。外貌酷似母亲星野爱。',
    hair_color: '金色', hair_style: '及腰长发（常披肩配侧分刘海，练习时高侧马尾或半马尾）', eye_color: '粉红与红色渐变',
    body: { height_cm: 158, build: '纤细', cup: 'B', leg_type: '修长', skin: { base_tone: '白皙', tan: 3, texture: '细腻' } },
    attributes: { '力量': 3, '敏捷': 6, '体质': 4, '智力': 6, '感知': 8, '魅力': 18 },
    skills: { '口才': 8, '运动': 7 },
    personality_brief: '元气天真的偶像少女。前世长年卧病在床，今生对一切充满热情和好奇，格外珍惜健康的人生。舞台上充满活力自信，私下里更像一个普通的妹妹和热情的偶像宅。内心在「纯粹向往偶像舞台」和「不得不面对娱乐圈残酷现实」之间挣扎。初期对网络暴力感到震惊，后来逐渐冷酷地认识到这个世界不干净。',
    personality_stages: {
      '6': '转生者。作为星野爱的女儿出生，对自己成为偶像的女儿狂喜。4岁时目睹母亲被谋杀，决心继承母亲遗志成为偶像。',
      '12': '继续偶像训练。因前世创伤跳舞时会有心因性障碍而绊倒。对前世暗恋的医生雨宫吾郎的思念从未减弱。',
      '16': '陽東高中演艺科学生，新生B小町Center。偶像事业蒸蒸日上。在追寻母亲足迹的过程中发现了娱乐圈的黑暗面——从震惊到接受的转变让她偶尔显得冷酷。与阿库亚相处时是一个普通的妹妹和热情的偶像宅。对恋爱和初体验抱有极大好奇。R18话题会让她兴奋和好奇——指望哪天能用上。'
    },
    speech_style: '说话充满活力、直接且情绪化，常夹杂年轻人俚语。舞台上语调和节奏经过训练完美掌控。私下里和阿库亚说话时更随意——妹妹对哥哥的撒娇和吐槽。提到妈妈（星野爱）时会变得格外认真和深情。',
    anchors: {
      emotional: '元气天真的偶像少女——前世长年卧病在床让她对今生的一切充满狂热的珍惜。想做的事就去做才是人生——这是她的核心信条。4岁目睹母亲被谋杀是她人生的分水岭。舞台上闪耀的偶像光芒背后，是一个在残酷娱乐圈中逐渐成长、偶尔冷酷的现实主义者。对网络暴力从震惊到反抗——"别把受害者用来安慰自己的话，当作你伤害别人的免罪符"。',
      intimate: '对恋爱和初体验抱有极大好奇与渴望——前世没能经历的都想在今生实现。一直在寻找前世暗恋的医生雨宫吾郎。R18作品会让她兴奋和好奇——指望哪天能用上。在感情上积极直接，不掩饰自己的欲望和好奇。对阿库亚既是妹妹又不止是妹妹——复杂的感情她自己也在摸索。',
      private: '星野家的秘密只有兄妹二人知道：他们都是星野爱狂热粉丝的转世者。前世天童寺纱利奈，12岁因绝症去世，唯一的慰藉是星野爱和雨宫吾郎医生。转生为星野爱的女儿——终极粉丝的梦想成真。兄妹私下会吐槽交流——两人都知道对方是爱的粉丝转世，但不知道对方前世具体是谁。阿库亚不知道他前世就是自己一直在找的雨宫吾郎。她也不知道阿库亚的前世。唱歌是她最不擅长的事——这是她与自己偶像母亲之间那道跨不过去的差距。'
    },
    likes: ['偶像（尤其星野爱）', '跳舞', '舞台表演', '雨宫吾郎', '粉红色', '恋爱和初体验的想象'],
    dislikes: ['谎言（初期）', '网络诽谤', '不公', '利用他人', '自己的歌声'],
    default_location: '阳东高中',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '社会人' },
    schedule_group: '高校生', funds: 8000, sex_profile: '星野瑠美衣'
  }
];

const newSPs = {
  '黑川茜': {
    baselineDesire: 45, attitude: '顺从', experience: '未开发',
    female: { breast: { cup: 'B', shape: '水滴', nipple_size: '普通', nipple_color: '粉色', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '普通', depth_cm: 14, tightness: '紧致', inner_color: '玫瑰', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '蓝紫色', style: '自然' }, clitoris: '普通' },
    bodyParts: { '唇': { sensitivity: 7, development: 0, preference: '喜欢' }, '颈': { sensitivity: 6, development: 0, preference: '普通' }, '胸': { sensitivity: 7, development: 0, preference: '普通' }, '腰': { sensitivity: 6, development: 0, preference: '普通' }, '腿': { sensitivity: 6, development: 0, preference: '喜欢' }, '秘部': { sensitivity: 5, development: 0, preference: '普通' }, '肛': { sensitivity: 2, development: 0, preference: '排斥' } },
    cycleDay: 11, climaxThreshold: 40,
    likes: ['被温柔引导', '恋人面前撒娇', '互相支持的关系', '扮演角色'], dislikes: ['粗暴', '背叛感', '网络暴力', '被无视']
  },
  '星野瑠美衣': {
    baselineDesire: 55, attitude: '好奇', experience: '未开发',
    female: { breast: { cup: 'B', shape: '水滴', nipple_size: '普通', nipple_color: '粉色', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 14, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '金色', style: '自然' }, clitoris: '隐藏' },
    bodyParts: { '唇': { sensitivity: 7, development: 0, preference: '喜欢' }, '颈': { sensitivity: 6, development: 0, preference: '普通' }, '胸': { sensitivity: 8, development: 0, preference: '好奇' }, '腰': { sensitivity: 6, development: 0, preference: '普通' }, '腿': { sensitivity: 7, development: 0, preference: '喜欢' }, '秘部': { sensitivity: 6, development: 0, preference: '好奇' }, '肛': { sensitivity: 3, development: 0, preference: '排斥' } },
    cycleDay: 14, climaxThreshold: 38,
    likes: ['初次体验的兴奋', '被珍视的感觉', '偶像扮演', '积极的探索'], dislikes: ['太被动的对方', '不干净的地方', '被欺骗感情']
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
