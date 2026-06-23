const fs = require('fs');
const path = require('path');

const newChars = [
  {
    name: '式守都', source: '式守同学不只可爱而已', base_age: 16, gender: 'female',
    appearance_brief: '粉蓝渐变长发、蓝粉色眼睛。温柔可爱的少女，关键时刻会展现出强大气场。',
    hair_color: '粉蓝渐变', hair_style: '长发（运动时高马尾）', eye_color: '蓝粉色',
    outfits: {
      school: { top: '总武高制服外套', bottom: '黑白百褶裙', legs: '黑色过膝袜', feet: '皮鞋', shirt: '长袖衬衫', desc: '标准总武高制服，黑白百褶裙，黑色过膝袜。' },
      pe: { shirt: '白色体操服', bottom: '深蓝运动短裤', feet: '运动鞋', hair: '高马尾', desc: '运动时高马尾，方便活动的运动装。' }
    },
    body: { height_cm: 162, weight_kg: 48, build: '纤细', cup: 'B', leg_type: '修长', skin: { base_tone: '白皙', tan: 5, texture: '细腻' } },
    attributes: { '力量': 5, '敏捷': 9, '体质': 6, '智力': 7, '感知': 10, '魅力': 14 },
    skills: { '运动': 8, '格斗': 4, '口才': 5 },
    personality_brief: '表面温柔可爱的少女，在恋人面前喜欢撒娇。但关键时刻会变身强大可靠的守护者——运动神经发达，有强烈的责任心和保护欲。隐藏着对曾经假小子形象的小小自卑，和一份不坦率的傲娇。',
    personality_stages: { '6': '活泼好动的小女孩，喜欢运动不喜欢裙子。被叫做假小子虽然不说什么但心里介意。', '12': '开始在意自己的形象，尝试打扮得可爱。运动能力同龄人中拔尖。保护欲开始萌芽。', '16': '完美平衡了可爱与强大。在恋人面前撒娇嗔怪，在危机面前冷峻可靠。对曾经的假小子形象仍有小小自卑。' },
    speech_style: '平时温柔可爱，喜欢用语气词撒娇。保护恋人时语气变得有气势和自信。面对恋人会切换为软糯娇羞模式。偶尔露出霸道强势的一面。',
    anchors: {
      emotional: '外表可爱温柔，内心强大有责任感。在恋人面前撒娇嗔怪，在危急时刻变身守护者。运动神经发达，对自己不可爱的过去有小小自卑。喜欢被恋人依赖，也喜欢被恋人保护。',
      intimate: '对恋人极其关心和照顾，喜欢用行动表达爱意。保护欲爆棚时会展现出惊人的气场和果断。私下里喜欢被恋人夸奖可爱——那是她最在意的词。',
      private: '曾经是假小子形象，为此有过自卑。努力成为可爱的式守同学是为了被认可也是自我实现。对自己要求很高。运动是她最自信的领域。'
    },
    likes: ['和恋人在一起', '运动', '时尚', '可爱的装扮'], dislikes: ['保护不了重要的人', '破坏可爱形象的事', '不公平'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' },
    schedule_group: '高校生', funds: 3000, sex_profile: '式守都'
  },
  {
    name: '天乃莉莉纱', source: '2.5次元的诱惑', base_age: 16, gender: 'female',
    appearance_brief: '干燥玫瑰粉及肩短发、淡蓝色眼睛、红框半框眼镜。二次元体型的社恐阴角美少女。',
    hair_color: '干燥玫瑰粉', hair_style: '及肩中短发 Bob 头', eye_color: '淡蓝色', hair_accessories: '红框半框眼镜',
    outfits: {
      school: { top: '总武高制服外套', bottom: '黑白百褶裙', legs: '黑色过膝袜', feet: '皮鞋', acc: '红色蝴蝶结', desc: '标准总武高制服，领口红色蝴蝶结。' }
    },
    body: { height_cm: 163, weight_kg: 47, build: '纤细', cup: 'C', leg_type: '修长', skin: { base_tone: '白皙', tan: 3, texture: '细腻' } },
    attributes: { '力量': 2, '敏捷': 3, '体质': 3, '智力': 8, '感知': 12, '魅力': 13 },
    skills: { '口才': 3, '学习': 6, '手工': 9 },
    personality_brief: '社恐阴角——日常说话吞吐眼神闪躲。但对ACG的狂热能瞬间切换人格：语速极快充满热情，为完美还原角色不惜一切努力。被莉莉艾露拯救了童年，现在用Cosplay拯救自己。',
    personality_stages: { '6': '安静内向的女孩，在学校不合群。被动画角色莉莉艾露拯救——那是她第一次觉得世界上有理解自己的人。', '12': '因ACG兴趣被同学排挤变得更加退缩。私下对Cosplay的热情开始萌芽。', '16': '加入漫研社，第一次Cosplay被奥村认可后找到容身之所。日常仍是社恐阴角，进入宅模式后判若两人。拥有完全再现(ROM)角色的惊人能力。' },
    speech_style: '日常声音细若蚊蝇，常用那个...开头。进入宅模式后语速极快充满热情。对奥村称呼前辈，语气充满依赖。话题转到莉莉艾露时会进入滔滔不绝状态。',
    anchors: {
      emotional: '社恐阴角——在现实社交中极度不安，但对ACG有近乎偏执的狂热。被莉莉艾露拯救了童年，从此Cosplay成为她与世界对话的方式。在宅领域有惊人的行动力和完美主义。',
      intimate: '对奥村前辈有深度依赖——他是第一个认可她Cosplay的人。在他面前会放松警惕。情感表达极其笨拙——不会说喜欢但会熬夜为他做最完美的Cos服。',
      private: '小学时因ACG兴趣被排挤的经历影响深远。对现充社交有恐惧。父亲是著名摄影师，家境富裕但亲情冷淡。漫研社和莉莉艾露是她的一切。'
    },
    likes: ['莉莉艾露', '奥村正宗', 'Cosplay', '制作Cos服'], dislikes: ['现实社交', '体育', '现充氛围', '被注视'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' },
    schedule_group: '高校生', funds: 5000, sex_profile: '天乃莉莉纱'
  },
  {
    name: '橘美花莉', source: '2.5次元的诱惑', base_age: 16, gender: 'female',
    appearance_brief: '栗色双马尾、玫红色眼睛。全校公认的现充美少女，模特身材，左侧马尾粉色蝴蝶结。',
    hair_color: '栗色', hair_style: '双马尾', eye_color: '玫红色', hair_accessories: '粉色蝴蝶结',
    outfits: {
      school: { top: '总武高制服外套', bottom: '百褶裙（比标准更短）', legs: '白色短袜', feet: '小皮鞋', acc: '粉色蝴蝶结、耳环', desc: '制服外套搭米色针织衫，百褶裙比标准短一截，整条腿大面积露出。' }
    },
    body: { height_cm: 160, weight_kg: 46, build: '纤细', cup: 'B', leg_type: '修长', skin: { base_tone: '白皙', tan: 5, texture: '细腻' } },
    attributes: { '力量': 3, '敏捷': 5, '体质': 4, '智力': 7, '感知': 10, '魅力': 16 },
    skills: { '口才': 7, '运动': 4, '手工': 5 },
    personality_brief: '全校公认的优雅现充美少女——高岭之花长袖善舞。本质是沉重专一的败犬系青梅：为战胜2D女生恶补宅知识，为攻略奥村以美美身份出道Cosplay。傲娇+恋爱脑+病娇潜质。',
    personality_stages: { '6': '活泼自信的小女孩，和邻居奥村是青梅竹马。曾向他展示裙子被以只爱2D无视——这句话成为她此后十年的人生驱动力。', '12': '立志超越2D女生。因模仿动画摔倒羞耻而封印宅属性。开始以成为完美的现充美少女为目标。', '16': '全校公认的现充美少女。以美美之名在漫展出道试图用Cosplay攻略奥村。加入漫研社后与理利沙成为情敌兼挚友兼搭档。表面优雅内心狂暴。' },
    speech_style: '平时说话有现充女生的自信和轻快。面对奥村时语气变得急切害羞或带有沉重的压迫感。内心独白极其丰富——经常在心里疯狂吐槽或自我攻略。',
    anchors: {
      emotional: '表面高岭之花，内核为爱暴走的败犬系青梅。为战胜2D女生这个情敌拼了十年。傲娇是保护色，恋爱脑是底层代码。被无视会低沉一整天，被夸奖会开心到飞起但嘴上绝对不承认。',
      intimate: '对奥村的感情沉重而专一。会用Cosplay、模特工作甚至学习成绩来证明自己比2D女生更值得被爱。嫉妒心强但努力克制，和理利沙是情敌也是最重要的搭档。',
      private: '童年被奥村以只爱2D拒绝是核心创伤。模仿动画摔倒的经历让她封印宅属性多年。所有的外在成就都指向同一个目标——让奥村爱上现实中的自己。'
    },
    likes: ['奥村正宗', '时尚', 'Cosplay', '被夸奖'], dislikes: ['2D女生（情敌）', '被奥村无视', '输给理利沙', '虫子'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' },
    schedule_group: '高校生', funds: 8000, sex_profile: '橘美花莉'
  },
  {
    name: '绫濑沙季', source: '义妹生活', base_age: 17, gender: 'female',
    appearance_brief: '金色长发、紫色眼睛。成绩优异外貌出众的完美美少女。外表冷淡锐利，实则是努力家。',
    hair_color: '金色', hair_style: '长直（一丝不苟）', eye_color: '紫色',
    outfits: {
      school: { top: '校服制服外套', bottom: '百褶裙', desc: '校服穿得无可挑剔，搭配略显花哨但不违规的饰品。' }
    },
    body: { height_cm: 163, weight_kg: 48, build: '匀称', cup: 'B', leg_type: '修长', skin: { base_tone: '白皙', tan: 3, texture: '细腻' } },
    attributes: { '力量': 3, '敏捷': 4, '体质': 4, '智力': 14, '感知': 12, '魅力': 15 },
    skills: { '学习': 9, '口才': 6, '手工': 7 },
    personality_brief: '表面冷淡疏离的完美优等生，内心极度渴望被无条件爱和接纳。用完美武装自己是因为长期被外界以成就而非本质来评价。外冷内热，勤奋好强，正在缓慢学习如何依赖他人。',
    personality_stages: { '6': '成长于单亲家庭，很小就意识到生活不易。被母亲严格要求在学业仪容各方面做到最好。因外貌出众容易成为焦点也因此招来嫉妒——开始学会用冷淡保护自己。', '12': '追求完美的习惯已牢固。很少得到基于自身而非成就的夸奖。自我价值与外在评价高度绑定。', '17': '高中年级前几的美少女。母亲再婚带来了新家庭。内心对亲密关系既渴望又恐惧。正在缓慢学习如何依赖和表达。料理是她为数不多能放松的时刻。' },
    speech_style: '语气礼貌而疏远，避免过多私人话题。对不信任的人说话简短冷淡。对信任的人会小心翼翼地试探——语句变短变犹豫，偶尔流露出真实的疲惫。',
    anchors: {
      emotional: '外冷内热的完美主义者。长期被以成就而非本质评价，害怕失败和不完美。极度渴望无条件的爱和接纳——但这渴望被她用冷淡的盔甲严密包裹。正在学习：有人会爱不完美的自己。',
      intimate: '在亲密关系中极度被动且缺乏安全感——需要漫长耐心的引导和绝对的尊重。将性视为关系的终极考验抱有极高的严肃性和恐惧。渴望一个能看穿她逞强给予坚定支持的臂膀。',
      private: '单亲家庭长大，长期目睹母亲为生计奔波。从未见过亲生父亲或有过不快经历。母亲将未实现的期望寄托在她身上。料理是她少数的放松。有写日记的习惯——是唯一能卸下所有面具的地方。'
    },
    likes: ['料理', '独处', '秩序', '写日记'], dislikes: ['失控', '暴露缺点', '被物化', '被轻视'],
    default_location: '千叶',
    schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' },
    schedule_group: '高校生', funds: 4000, sex_profile: '绫濑沙季'
  },
  {
    name: '羽生真由梨', source: '2.5次元的诱惑', base_age: 22, gender: 'female',
    appearance_brief: '紫黑色长发、浅紫色眼睛、金属细框眼镜。J cup爆炸性身材，嘴角左边有痣。总武高美术教师兼漫研社顾问。',
    hair_color: '紫黑色', hair_style: '松弛微凌乱长发（不对称）', eye_color: '浅紫色', face_accessories: '金属细框眼镜，左嘴角泪痣',
    outfits: {
      school: { top: '白色女式衬衫（紧身）', bottom: '紧身长裙', legs: '肉色丝袜', feet: '高跟鞋', acc: '金属细框眼镜', desc: '紧身白衬衫被J杯绷得纽扣危险，包裹臀部的紧身裙，禁欲系教师形象。' }
    },
    body: { height_cm: 168, weight_kg: 56, build: '沙漏型', cup: 'J', leg_type: '丰满', skin: { base_tone: '冷白', tan: 3, texture: '细腻' } },
    attributes: { '力量': 3, '敏捷': 3, '体质': 4, '智力': 10, '感知': 10, '魅力': 16 },
    skills: { '口才': 7, '学习': 7, '手工': 9 },
    personality_brief: '表面是认真负责的年轻美术教师，努力维持社会人形象。内里是隐藏的资深御宅族兼传说级Coser真由罗——为现实放弃了梦想。有强烈百合倾向，对可爱女生毫无抵抗力（会流鼻血）。心地善良好欺负。',
    personality_stages: { '12': '对动漫和Cosplay产生浓厚兴趣的天才少女。手作能力出众。', '16': '以高中生Coser真由罗身份在Comiket一战成名，被称为四天王之一。', '20': '大学期间为专心学业停止了所有Cosplay活动。决心与过去告别但内心对Cosplay仍有遗憾。', '22': '新任总武高美术教师。被迫担任漫研社顾问——发现持有自己黑历史的学生就在这所学校。看到可爱女生Cosplay会流鼻血。' },
    speech_style: '作为教师尽量使用标准礼貌敬语，语气强装沉稳但带着大学生的天真气质。涉及爱好或被戳中弱点时瞬间破功——语速变快情绪激动暴露出宅女本性。威胁学生时毫无压迫感。',
    anchors: {
      emotional: '表面是认真负责的美术教师。内心是隐藏的资深御宅族——被迫放弃Cosplay梦想后仍深深热爱。对可爱女生完全没有抵抗力（百合倾向），看到好Cos会激动到流鼻血。本质上善良天真好欺负。',
      intimate: '对Cosplay的热爱深入骨髓——被迫放弃后内心一直有空洞。当真由罗的过去是骄傲也是伤口。身材是她最大的武器也是羞耻源——J杯总是在衬衫里绷得危险。格斗游戏高手。',
      private: '高中时以真由罗之名在Comiket封神。为现实（学生贷款）放弃梦想成为教师。在总武高重逢自己的黑历史。漫研社的顾问是她的救赎也是煎熬——看着学生追逐Cosplay梦想既欣慰又心酸。喜欢设计服装——这是她为数不多仍保留的真由罗碎片。'
    },
    likes: ['Cosplay', '格斗游戏', '指导学生', '设计服装'], dislikes: ['学生贷款', '过去曝光', '无法坦率享受爱好'],
    default_location: '千叶市立总武高等学校',
    schedule_group_by_age: { '12': '中学生', '16': '高校生', '20': '大学生', '22': '社会人' },
    schedule_group: '社会人', funds: 15000, sex_profile: '羽生真由梨'
  }
];

const newSPs = {
  '式守都': { baselineDesire: 40, attitude: '顺从', experience: '未开发', female: { breast: { cup: 'B', shape: '水滴', nipple_size: '小', nipple_color: '淡粉', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 13, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '黑色', style: '自然' }, clitoris: '隐藏' }, bodyParts: { '唇': { sensitivity: 6, development: 0, preference: '喜欢' }, '颈': { sensitivity: 7, development: 0, preference: '喜欢' }, '胸': { sensitivity: 6, development: 0, preference: '普通' }, '腰': { sensitivity: 5, development: 0, preference: '普通' }, '腿': { sensitivity: 5, development: 0, preference: '普通' }, '秘部': { sensitivity: 4, development: 0, preference: '普通' }, '肛': { sensitivity: 2, development: 0, preference: '排斥' } }, cycleDay: 11, climaxThreshold: 40, likes: ['被恋人夸奖可爱', '温柔的触摸', '互相守护的关系'], dislikes: ['被当假小子', '无力保护', '太粗暴'] },
  '天乃莉莉纱': { baselineDesire: 30, attitude: '羞涩', experience: '未开发', female: { breast: { cup: 'C', shape: '水滴', nipple_size: '小', nipple_color: '淡粉', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 13, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '浅褐', style: '自然' }, clitoris: '隐藏' }, bodyParts: { '唇': { sensitivity: 5, development: 0, preference: '普通' }, '颈': { sensitivity: 6, development: 0, preference: '普通' }, '胸': { sensitivity: 7, development: 0, preference: '普通' }, '腰': { sensitivity: 5, development: 0, preference: '普通' }, '腿': { sensitivity: 5, development: 0, preference: '普通' }, '秘部': { sensitivity: 4, development: 0, preference: '害羞' }, '肛': { sensitivity: 2, development: 0, preference: '排斥' } }, cycleDay: 16, climaxThreshold: 45, likes: ['被温柔引导', 'Cosplay角色扮演', '安全的环境'], dislikes: ['被注视身体', '太快的节奏', '现实社交压力'] },
  '橘美花莉': { baselineDesire: 45, attitude: '主动', experience: '未开发', female: { breast: { cup: 'B', shape: '水滴', nipple_size: '小', nipple_color: '粉色', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 14, tightness: '紧致', inner_color: '玫瑰', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '褐色', style: '修剪' }, clitoris: '普通' }, bodyParts: { '唇': { sensitivity: 7, development: 0, preference: '喜欢' }, '颈': { sensitivity: 6, development: 0, preference: '普通' }, '胸': { sensitivity: 8, development: 0, preference: '喜欢' }, '腰': { sensitivity: 6, development: 0, preference: '普通' }, '腿': { sensitivity: 7, development: 0, preference: '喜欢' }, '秘部': { sensitivity: 6, development: 0, preference: '普通' }, '肛': { sensitivity: 3, development: 0, preference: '排斥' } }, cycleDay: 9, climaxThreshold: 40, likes: ['被注视', '赢过情敌', '被夸可爱', '主动进攻'], dislikes: ['被无视', '被比较', '输给情敌'] },
  '绫濑沙季': { baselineDesire: 20, attitude: '防御', experience: '未开发', female: { breast: { cup: 'B', shape: '水滴', nipple_size: '小', nipple_color: '淡粉', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 13, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '金色', style: '自然' }, clitoris: '隐藏' }, bodyParts: { '唇': { sensitivity: 5, development: 0, preference: '普通' }, '颈': { sensitivity: 7, development: 0, preference: '敏感' }, '胸': { sensitivity: 6, development: 0, preference: '普通' }, '腰': { sensitivity: 5, development: 0, preference: '防御' }, '腿': { sensitivity: 5, development: 0, preference: '普通' }, '秘部': { sensitivity: 3, development: 0, preference: '防御' }, '肛': { sensitivity: 2, development: 0, preference: '排斥' } }, cycleDay: 18, climaxThreshold: 60, likes: ['绝对的安全感', '笨拙的温柔', '被认可内在'], dislikes: ['被物化', '被期待', '失控', '亏欠感'] },
  '羽生真由梨': { baselineDesire: 50, attitude: '期待', experience: '青涩', female: { breast: { cup: 'J', shape: '纺锤', nipple_size: '普通', nipple_color: '浅褐', areola_size: '普通', feel: '柔软沉重' }, vagina: { type: '贝壳', labia_size: '普通', depth_cm: 15, tightness: '普通', inner_color: '玫瑰', feel: '普通' }, pubic_hair: { amount: '普通', color: '黑色', style: '自然' }, clitoris: '普通' }, bodyParts: { '唇': { sensitivity: 6, development: 1, preference: '普通' }, '颈': { sensitivity: 6, development: 1, preference: '普通' }, '胸': { sensitivity: 9, development: 2, preference: '害羞' }, '腰': { sensitivity: 6, development: 1, preference: '普通' }, '腿': { sensitivity: 5, development: 1, preference: '普通' }, '秘部': { sensitivity: 5, development: 1, preference: '普通' }, '肛': { sensitivity: 3, development: 0, preference: '排斥' } }, cycleDay: 13, climaxThreshold: 45, likes: ['Cosplay角色扮演', '被赞美身材（私下）', '百合幻想'], dislikes: ['被粗鲁对待', '学生在场时暴露', '被嘲笑'] }
};

// Update character files
for (const file of ['worldpacks/oregairu/characters.json', 'data/characters.json']) {
  const arr = JSON.parse(fs.readFileSync(path.resolve(file), 'utf-8'));
  for (const nc of newChars) {
    if (!arr.find(c => c.name === nc.name)) arr.push(nc);
  }
  fs.writeFileSync(path.resolve(file), JSON.stringify(arr, null, 2));
  console.log('Updated', file, '->', arr.length, 'chars');
}

// Update sex profiles
const sp = JSON.parse(fs.readFileSync(path.resolve('data/sex_profiles.json'), 'utf-8'));
for (const [name, data] of Object.entries(newSPs)) {
  if (!sp[name]) sp[name] = data;
}
fs.writeFileSync(path.resolve('data/sex_profiles.json'), JSON.stringify(sp, null, 2));
console.log('Added', Object.keys(newSPs).length, 'sex profiles, total:', Object.keys(sp).length);
console.log('Done');
