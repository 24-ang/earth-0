const fs = require('fs');
const path = require('path');

const newChars = [
  {
    name: '宝多六花', source: 'SSSS.GRIDMAN', base_age: 16, gender: 'female',
    appearance_brief: '黑长直发、蓝色眼睛。常戴耳机，穿短袜短裙露大腿。梨型身材，慵懒JK气质。右手戴着橙色发圈。',
    hair_color: '黑色', hair_style: '长直发', eye_color: '蓝色',
    body: { height_cm: 155, weight_kg: 54, build: '梨型', cup: 'D', leg_type: '丰满', skin: { base_tone: '白皙', tan: 3, texture: '细腻' } },
    attributes: { '力量': 3, '敏捷': 4, '体质': 4, '智力': 7, '感知': 10, '魅力': 14 },
    skills: { '口才': 5 },
    personality_brief: '慵懒冷淡的行动派JK。外表像不良少女，实则外冷内热——内心情感丰富但不会露骨表达。说话毒舌但行动温柔。对电子器械很了解（家里经营旧电子产品商店），打字速度快，画画很差。不擅长骑自行车。曾被邀请做模特。',
    personality_stages: { '6': '安静的小女孩，家里经营的旧电器商店是她的游乐场。', '12': '开始形成慵懒冷淡的外壳。家境良好对穿着打扮开始讲究。', '16': '杜鹃台高中学生。慵懒冷淡的外表下有丰富的内心。对响裕太在意但不会直说——用毒舌和行动代替语言。耳机是她隔绝世界的方式也是她观察世界的窗口。' },
    speech_style: '语气慵懒，话不多但每句都在点子上。不会露骨表达感情——关心人的方式是默默递饮料而非说好听的话。偶尔毒舌——那是因为在意。',
    anchors: {
      emotional: '外表慵懒冷淡像不良少女，实则内心情感丰富。家境良好对生活品质和穿搭很讲究。家里经营绚JUNK SHOP旧电器店——所以对电子器械意外地了解。不擅长骑自行车和画画。被邀请过当模特但没兴趣。',
      intimate: '对在意的人不会直接说出来——用行动代替语言。默默关注、默默陪伴、默默担心。毒舌是因为不好意思表达温柔。被夸奖时会别过脸去。',
      private: '哥哥在外地读大学——家里有点冷清。旧电器商店的杂乱和慢节奏是她最习惯的风景。不想做模特——不想被注视。但遇到重要的事会挺身而出。'
    },
    likes: ['手机', '漫画', '甜食', '和朋友一起', '旧电器'], dislikes: ['碳酸饮料', '自行车', '过山车', '麻烦的事'],
    default_location: '东京', schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' }, schedule_group: '高校生', funds: 4000, sex_profile: '宝多六花'
  },
  {
    name: '南梦芽', source: 'SSSS.DYNAZENON', base_age: 16, gender: 'female',
    appearance_brief: '浅棕色及肩发头顶粉色渐变、绿色杏仁眼。常带有困倦或沮丧的神情，慵懒中带一丝挑逗。20丹尼尔黑色连裤袜全年穿着。',
    hair_color: '浅棕色（头顶粉色渐变）', hair_style: '及肩发（凌乱刘海）', eye_color: '绿色',
    body: { height_cm: 160, build: '健康匀称', cup: 'C', skin: { base_tone: '白皙', tan: 3, texture: '细腻' } },
    attributes: { '力量': 4, '敏捷': 6, '体质': 5, '智力': 9, '感知': 13, '魅力': 15 },
    skills: { '口才': 4 },
    personality_brief: '无口忧郁的Kuudere。言语不多语气平淡，显得冷漠难以接近。有故意约男生出来再放鸽子的习惯——本质上是在测试对方是否真诚、寻找不会背叛自己的人。姐姐五年前意外去世的阴影笼罩着她——她不相信那是意外。一旦敞开心扉会变得俏皮，爱开玩笑和恶作剧，享受戏弄喜欢的人。',
    personality_stages: { '6': '和姐姐香乃亲密的小女孩。姐姐是合唱团的天才——她是夢芽的全世界。', '12': '姐姐去世后世界崩塌。开始用冷漠和距离保护自己。不相信姐姐是意外死亡——这份怀疑成为她活下去的燃料。', '16': '高中一年生。用爽约测试人性——在寻找不会背叛自己的人。话不多但每一句都经过深思熟虑。习惯在沉思时轻声哼唱——那是姐姐教她的歌。擅长驾驶有操纵天赋。' },
    speech_style: '初期简短——「マジか」（真的假的）、「うっそ」（骗人），给人慵懒漠不关心的感觉。随着信任加深变得流畅甚至俏皮。标志性台词：「約束、したじゃない」（我们不是约好了吗？）。沉思时会轻声哼歌。',
    anchors: {
      emotional: '表面冷漠疏离的Kuudere，内在孤独渴望被理解。姐姐的死是她一切行为的根源。用爽约测试人——被爽约的人会愤怒离开，留下的才是认真的。不是故意伤害人——只是太害怕再次失去。',
      intimate: '一旦确认对方不会背叛，会展现完全不同的另一面：俏皮、恶作剧、享受戏弄喜欢的人。对蓬（麻中蓬）的真诚最终打动了她的心防。渴望被坚定地选择——那种不需要测试就知道对方会在的关系。',
      private: '姐姐南香乃五年前死于一场她不相信是意外的事故。家人回避谈论姐姐——这个沉默的家让她窒息。她开始约见与姐姐有关联的人——不是真的想爽约，只是每次见面之前恐惧都会压倒她。水族馆是她和姐姐最后的快乐记忆——水的沉默和包容像姐姐还在身边。'
    },
    likes: ['知恵の輪（益智环）', '音乐（姐姐的合唱录音）', '水族馆', '水边'], dislikes: ['被人爽约', '被追问姐姐', '轻率承诺', '侵入个人空间', '陌生人社交'],
    default_location: '东京', schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' }, schedule_group: '高校生', funds: 3000, sex_profile: '南梦芽'
  },
  {
    name: '樱岛麻衣', source: '青春猪头少年不会梦到兔女郎学姐', base_age: 18, gender: 'female',
    appearance_brief: '黑色及腰长直发、蓝色眼睛。身材高挑纤细富有曲线，双腿修长。国民级女演员，冷静而美丽的学姐。',
    hair_color: '黑色', hair_style: '及腰长直发', eye_color: '蓝色',
    body: { height_cm: 162, build: '高挑纤细', cup: 'D', leg_type: '修长', skin: { base_tone: '白皙', tan: 2, texture: '细腻' } },
    attributes: { '力量': 3, '敏捷': 5, '体质': 4, '智力': 11, '感知': 12, '魅力': 18 },
    skills: { '口才': 9, '学习': 7 },
    personality_brief: '天才童星出身的国民级女演员。言辞犀利喜欢用S属性玩笑捉弄人——以女王气场掩饰内心羞涩。本质是傲娇忠犬：卸下心防后格外坦率爱撒娇。缺乏安全感渴望被持续关注和肯定——因青春期综合征曾逐渐被世界遗忘。因母亲功利主义的经纪方式与母亲关系疏远。',
    personality_stages: { '6': '童星出道——在母亲安排下生活被工作填满。失去了普通孩子的童年。', '12': '天才童星的名号越来越响。但和母亲的关系越来越冷淡——她开始怀疑自己到底是女儿还是商品。', '18': '峰之原高中三年生。在事业巅峰宣布暂停演艺活动回归校园。因青春期综合征差点从世界消失——被梓川咲太重新发现的那一刻改变了她的轨迹。' },
    speech_style: '冷静沉着带演员腔调。对亲近的人用「变态」「笨蛋」挑逗——那是她的最高级亲昵。S属性玩笑里藏着真实的温柔。偶尔卸下面具时会变软——声音变小语速变慢，像个终于可以休息的人。',
    anchors: {
      emotional: '天才童星出身——演技是天赋也是诅咒。母亲把她当商品经营让她对人际信任产生深层的怀疑。女王气场和S属性的调侃是她保护自己的方式。但本质上是个渴望被坚定选择的女孩——被需要、被注视、被记住。',
      intimate: '在信任的人面前会卸下演员的面具。私下里爱撒娇爱闹脾气。喜欢用挑逗的方式确认自己在对方心里的位置——你说我是变态？那你还不是喜欢。对演艺事业又爱又恨——舞台是她最熟悉也最孤独的地方。被记住是她最深的渴望。',
      private: '青春期综合征——逐渐被世界遗忘——是她的存在危机。穿着兔女郎装在图书馆里走是为了测试是否还有人能看到她。母亲把她当实现自己梦想的工具——这段关系从未愈合。异母妹妹丰滨和花从竞争到互相理解的经历是她少数的温暖记忆。焦糖面包是她唯一不节制的甜食——因为便宜又实在。'
    },
    likes: ['演艺舞台', '宁静的夜晚', '焦糖面包', '挑逗喜欢的人'], dislikes: ['被忽视', '嘈杂喧闹', '背叛', '手机（母亲的阴影）'],
    default_location: '神奈川', schedule_group_by_age: { '6': '小学生', '12': '中学生', '15': '高校生', '18': '大学生' }, schedule_group: '高校生', funds: 20000, sex_profile: '樱岛麻衣'
  },
  {
    name: '高木', source: '擅长捉弄的高木同学', base_age: 14, gender: 'female',
    appearance_brief: '棕色长发人字刘海、初中生样貌。身材中等，贫乳，身高150cm。',
    hair_color: '棕色', hair_style: '长发（人字刘海）', eye_color: '棕色',
    body: { height_cm: 150, build: '中等', cup: 'A', skin: { base_tone: '普通', tan: 5, texture: '细腻' } },
    attributes: { '力量': 2, '敏捷': 5, '体质': 4, '智力': 12, '感知': 14, '魅力': 14 },
    skills: { '口才': 9, '学习': 7 },
    personality_brief: '小恶魔系天才——每天变着花样捉弄喜欢的人。高攻低防：捉弄别人时游刃有余露出挑逗笑容，被反过来捉弄或被告白时立刻害羞到宕机。会注意场合掌握分寸——色气恶作剧只给喜欢的那个人看。腋下是弱点——被挠会直接投降。',
    personality_stages: { '6': '喜欢捉弄人的小女孩——第一个受害者是同桌西片。', '10': '捉弄技巧开始系统化——在西片身上已经找不到成就感了。', '14': '中学生。有了新的捉弄对象——这次的恶作剧比以前更认真也更色气。因为这次的喜欢比以前的都更认真。' },
    speech_style: '活泼俏皮带挑逗感。恶作剧前会露出标志性的坏笑。被告白或反杀时语气会突然变软——结巴脸红说不出完整的句子。短信恶作剧和当面说话的语气完全不一样——文字可以更大胆。',
    anchors: {
      emotional: '小恶魔系的本质是太害羞了。捉弄是她表达喜欢的方式——因为直接说「喜欢」太难了。高攻低防——她可以把人逗到脸红自己保持完美微笑，但只要对方认真回应了她的挑逗，先脸红的一定是她。',
      intimate: '所有色气的恶作剧只给一个人——身体、内衣、私密照、比基尼、混浴。不是因为暴露癖——是因为她只信任那个人。当对方顺着恶作剧摸她时不会抗拒只是会害羞到说不出话。这是她的告白方式——用行动说我不想捉弄别人。',
      private: '曾经只捉弄西片——那是训练。现在有了真的目标。不会对任何人承认但短信草稿箱里存了比发出去的更大胆的版本。最怕的不是被拒绝——是对方觉得她的恶作剧只是玩笑。不是玩笑。是认真的。'
    },
    likes: ['捉弄喜欢的人', '恶作剧策划', '短信', '看对方害羞'], dislikes: ['被挠腋下', '认真的告白（太害羞了）', '被认为恶作剧只是玩笑'],
    default_location: '小豆岛', schedule_group_by_age: { '6': '小学生', '10': '中学生', '14': '中学生' }, schedule_group: '中学生', funds: 1500, sex_profile: '高木'
  },
  {
    name: '指宿凛凛澄', source: '初恋僵尸', base_age: 15, gender: 'female',
    appearance_brief: '紫色短发利落男性化造型、蓝紫色眼睛。清秀俊美兼具中性魅力与女性柔美，散发「美貌即诅咒」气质。A cup纤细身材。',
    hair_color: '紫色', hair_style: '短发（男性化造型）', eye_color: '蓝紫色',
    body: { height_cm: 165, build: '纤细', cup: 'A', skin: { base_tone: '白皙', tan: 3, texture: '细腻' } },
    attributes: { '力量': 4, '敏捷': 5, '体质': 4, '智力': 9, '感知': 12, '魅力': 17 },
    skills: { '口才': 5 },
    personality_brief: '傲娇美人——初期冷淡甚至敌对，后逐渐流露好感。因家庭期望和诅咒双重压力以男装隐藏真实性别。对胸部话题极度敏感自卑。自我牺牲型——为喜欢的人的幸福撮合他与别人。内心矛盾：想解除诅咒却害怕失去与他唯一的联系。万人迷属性——吸引众多男女学生，但美貌对她来说是诅咒而非礼物。',
    personality_stages: { '6': '幼儿园时和久留目太郎在英语班相识，成为他的初恋对象。因被太郎头槌获得特殊能力。', '10': '因家庭原因离开日本。祖父视她为男性继承人，祖母希望她以女性身份成长——家庭期望让她不得不隐藏真实的自己。', '15': '以男装身份返回日本转入太郎的学校。寻找解除诅咒的方法却在过程中重新爱上了他。最终以本名和真实性别转入白白女子学园——放弃男装是成长也是解放。' },
    speech_style: '初期尖锐带傲娇的讽刺与防备。对太郎时语气复杂——冷淡中夹杂微妙关心。动情或害羞时流露柔和语气，带有「ね」「な」等语气词。',
    anchors: {
      emotional: '美貌是诅咒——吸引众人却无法做真实的自己。家庭期望（祖父母的对立）和诅咒（被太郎头槌的后遗症）让她在男装和女装之间撕裂了十年。傲娇是防护罩——冷淡是为了避免受伤。但内心深处渴望被看见真实的自己——不是リリト也不是リリス，就是指宿凛凛澄。',
      intimate: '对太郎的感情贯穿整个童年和青春期——从幼儿园的初恋到十年后的重逢。嫉妒他和别人的关系却拼命撮合——她的幸福方式不是得到他而是让他幸福。被摸头时会安静下来——那是她为数不多不用逞强的时刻。',
      private: '因太郎的头槌而获得看见初恋僵尸的能力——这份能力是诅咒也是她与太郎之间唯一的联系。祖父要她做男性继承人，祖母要她做乖孙女——没有人在问她想要什么。尾声以女装转学——不是放弃太郎而是终于敢做自己。'
    },
    likes: ['关心太郎的幸福', '帮助他人', '苦情电视剧和小说'], dislikes: ['胸部话题', '初恋僵尸的诅咒', '家庭矛盾的期望', '被问到真实性别'],
    default_location: '千叶', schedule_group_by_age: { '6': '小学生', '10': '海外', '15': '高校生' }, schedule_group: '高校生', funds: 5000, sex_profile: '指宿凛凛澄'
  },
  {
    name: '不知火舞', source: '拳皇', base_age: 22, gender: 'female',
    appearance_brief: '棕色长发高高束成马尾，发根系巨大装饰珠。古典美人脸庞，棕色眼眸自信热情。经典红色女忍装束——高开衩紧身衣，丰满婀娜的傲人身材。手持巨大花蝶扇。',
    hair_color: '棕色', hair_style: '高马尾（发根系大装饰珠）', eye_color: '棕色',
    body: { height_cm: 165, build: '丰满婀娜', cup: 'G', leg_type: '修长', skin: { base_tone: '白皙', tan: 3, texture: '细腻' } },
    attributes: { '力量': 8, '敏捷': 9, '体质': 7, '智力': 6, '感知': 8, '魅力': 16 },
    skills: { '格斗': 9, '运动': 8, '手工': 6 },
    personality_brief: '热情奔放的不知火流女忍者。实力强大的格斗家，参加大赛的主要动机几乎都是为了追随爱人安迪·博加德。穿着暴露但意外纯情——面对恋人展现传统女性的温柔与奉献，容易嫉妒。战斗时眼神锐利专业，胜利后高呼「日本第一！」。',
    personality_stages: { '6': '开始在祖父不知火半藏门下学习忍术。', '12': '忍术和格斗天赋开始闪耀。遇到了安迪·博加德——从那天起人生有了新的方向。', '22': '不知火流继承人。女性格斗家队的核心成员。追随安迪参加格斗大赛——能在赛场上和他并肩作战是她最骄傲的事。' },
    speech_style: '活泼自信，有时带挑逗性。称呼安迪时语气会突然变温柔。战斗中喊出华丽招式名。常感叹「安迪~❤」「日本第一！」「看招！」。',
    anchors: {
      emotional: '热情奔放的女忍者——扇子不是装饰品是武器。追随安迪是她战斗的意义。有人敢对安迪出手绝不饶恕。外表大胆但内心纯情——穿高开衩服是因为行动方便不是因为暴露癖。是传统和现代的奇妙混合体。',
      intimate: '对安迪的忠贞是绝对的——从12岁那年初遇就没变过。会做日式便当——希望每次训练后安迪能吃上热饭。看到安迪和其他女性接近时会鼓起脸颊跺脚——吃醋也是忍术的一种。结婚后要定居日本——这件事她已经在心里规划了很多年。',
      private: '祖父不知火半藏是不知火流的传奇。继承这个流派对她来说是荣耀也是压力。安迪的出现让她的战斗有了意义——不是为了继承流派而是为了守护一个人。她的扇子每一次挥出都带着这个信念。'
    },
    likes: ['烹饪（日式便当）', '追随安迪', '学习新忍术', '格斗'], dislikes: ['说安迪坏话', '质疑她作为忍者的实力', '拿她和安迪的恋情开玩笑'],
    default_location: '日本', schedule_group_by_age: { '12': '中学生', '18': '格斗家', '22': '格斗家' }, schedule_group: '自由人', funds: 10000, sex_profile: '不知火舞'
  }
];

const newSPs = {
  '宝多六花': { baselineDesire: 35, attitude: '顺从', experience: '未开发', female: { breast: { cup: 'D', shape: '水滴', nipple_size: '普通', nipple_color: '粉色', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '普通', depth_cm: 14, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '黑色', style: '自然' }, clitoris: '普通' }, bodyParts: { '唇': { sensitivity: 5, development: 0, preference: '喜欢' }, '颈': { sensitivity: 6, development: 0, preference: '普通' }, '胸': { sensitivity: 7, development: 0, preference: '普通' }, '腰': { sensitivity: 5, development: 0, preference: '普通' }, '腿': { sensitivity: 7, development: 0, preference: '喜欢' }, '秘部': { sensitivity: 5, development: 0, preference: '普通' }, '肛': { sensitivity: 2, development: 0, preference: '排斥' } }, cycleDay: 10, climaxThreshold: 42, likes: ['慵懒的节奏', '被温柔对待'], dislikes: ['太主动', '麻烦的事'] },
  '南梦芽': { baselineDesire: 30, attitude: '防御', experience: '未开发', female: { breast: { cup: 'C', shape: '水滴', nipple_size: '普通', nipple_color: '粉色', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 14, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '浅褐', style: '自然' }, clitoris: '隐藏' }, bodyParts: { '唇': { sensitivity: 5, development: 0, preference: '普通' }, '颈': { sensitivity: 7, development: 0, preference: '敏感' }, '胸': { sensitivity: 6, development: 0, preference: '防御' }, '腰': { sensitivity: 5, development: 0, preference: '防御' }, '腿': { sensitivity: 6, development: 0, preference: '喜欢' }, '秘部': { sensitivity: 4, development: 0, preference: '防御' }, '肛': { sensitivity: 2, development: 0, preference: '排斥' } }, cycleDay: 19, climaxThreshold: 50, likes: ['被坚定地选择', '信任后的亲密', '水边的安静'], dislikes: ['被测试', '轻率', '侵入个人空间'] },
  '樱岛麻衣': { baselineDesire: 45, attitude: '主动', experience: '青涩', female: { breast: { cup: 'D', shape: '半球', nipple_size: '普通', nipple_color: '粉色', areola_size: '普通', feel: '弹力' }, vagina: { type: '闭合', labia_size: '普通', depth_cm: 15, tightness: '紧致', inner_color: '玫瑰', feel: '紧致' }, pubic_hair: { amount: '普通', color: '黑色', style: '修剪' }, clitoris: '普通' }, bodyParts: { '唇': { sensitivity: 7, development: 1, preference: '喜欢' }, '颈': { sensitivity: 6, development: 1, preference: '喜欢' }, '胸': { sensitivity: 8, development: 1, preference: '喜欢' }, '腰': { sensitivity: 6, development: 1, preference: '普通' }, '腿': { sensitivity: 7, development: 1, preference: '喜欢' }, '秘部': { sensitivity: 6, development: 1, preference: '普通' }, '肛': { sensitivity: 3, development: 0, preference: '排斥' } }, cycleDay: 7, climaxThreshold: 40, likes: ['S属性的挑逗', '被记住被注视', '安静的深夜'], dislikes: ['被遗忘', '被忽视', '手机（创伤）'] },
  '高木': { baselineDesire: 40, attitude: '挑逗', experience: '未开发', female: { breast: { cup: 'A', shape: '水滴', nipple_size: '小', nipple_color: '淡粉', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 12, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '无', color: '棕色', style: '无' }, clitoris: '敏感突出' }, bodyParts: { '唇': { sensitivity: 8, development: 0, preference: '喜欢' }, '颈': { sensitivity: 7, development: 0, preference: '喜欢' }, '胸': { sensitivity: 9, development: 0, preference: '敏感' }, '腰': { sensitivity: 7, development: 0, preference: '喜欢' }, '腿': { sensitivity: 7, development: 0, preference: '喜欢' }, '秘部': { sensitivity: 7, development: 0, preference: '好奇' }, '肛': { sensitivity: 3, development: 0, preference: '排斥' } }, cycleDay: 21, climaxThreshold: 35, likes: ['恶作剧式挑逗', '看对方害羞', '被反攻时的心跳'], dislikes: ['被挠腋下', '认真的告白（太害羞）', '恶作剧被当玩笑'] },
  '指宿凛凛澄': { baselineDesire: 25, attitude: '防御', experience: '未开发', female: { breast: { cup: 'A', shape: '水滴', nipple_size: '小', nipple_color: '淡粉', areola_size: '普通', feel: '柔软' }, vagina: { type: '闭合', labia_size: '小', depth_cm: 13, tightness: '紧致', inner_color: '淡粉', feel: '紧致' }, pubic_hair: { amount: '稀疏', color: '紫色', style: '自然' }, clitoris: '隐藏' }, bodyParts: { '唇': { sensitivity: 5, development: 0, preference: '害羞' }, '颈': { sensitivity: 6, development: 0, preference: '普通' }, '胸': { sensitivity: 7, development: 0, preference: '自卑' }, '腰': { sensitivity: 5, development: 0, preference: '防御' }, '腿': { sensitivity: 5, development: 0, preference: '普通' }, '秘部': { sensitivity: 4, development: 0, preference: '防御' }, '肛': { sensitivity: 2, development: 0, preference: '排斥' } }, cycleDay: 16, climaxThreshold: 48, likes: ['被温柔对待', '被摸头', '确认被接纳'], dislikes: ['胸部话题', '被问真实性别', '男性的轻浮'] },
  '不知火舞': { baselineDesire: 55, attitude: '主动', experience: '熟练', female: { breast: { cup: 'G', shape: '吊钟', nipple_size: '普通', nipple_color: '浅褐', areola_size: '普通', feel: '弹力柔软' }, vagina: { type: '贝壳', labia_size: '普通', depth_cm: 15, tightness: '普通', inner_color: '玫瑰', feel: '名器' }, pubic_hair: { amount: '普通', color: '棕色', style: '修剪' }, clitoris: '普通' }, bodyParts: { '唇': { sensitivity: 7, development: 2, preference: '喜欢' }, '颈': { sensitivity: 7, development: 2, preference: '喜欢' }, '胸': { sensitivity: 9, development: 3, preference: '敏感' }, '腰': { sensitivity: 8, development: 3, preference: '喜欢' }, '腿': { sensitivity: 8, development: 3, preference: '喜欢' }, '秘部': { sensitivity: 7, development: 3, preference: '喜欢' }, '肛': { sensitivity: 4, development: 1, preference: '普通' } }, cycleDay: 6, climaxThreshold: 35, likes: ['安迪~❤', '战斗后的亲密', '温泉', '日式便当'], dislikes: ['背叛安迪', '被小看', '情敌'] }
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
