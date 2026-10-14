/* 校园二手优选 —— 免构建前端（Vue3 全局版 + Element Plus + Axios）
   通过 serve.js 代理 /api 与 /uploads 到后端，无需 npm 安装即可运行。 */
(function () {
  const { createApp, reactive, ref, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue;
  const { ElMessageBox } = ElementPlus;

  // ---------- 轻提示节流 ----------
  // 问题：连点「加购 / 收藏」会瞬间堆起一长串「已加入购物车」，把页面挡得看不清。
  // 处理：同文案 1 秒内不重复弹；最多同时保留 2 条，超出先关掉最旧的那条。
  const __MAX_TOASTS = 2;
  const __toasts = [];
  function __toast(type, message, opts) {
    const text = String(message == null ? '' : message);
    const now = Date.now();
    for (let i = __toasts.length - 1; i >= 0; i--) if (now - __toasts[i].t > 900) __toasts.splice(i, 1);
    if (__toasts.some((m) => m.text === text)) return;      // 同内容还在显示 → 不再重复
    while (__toasts.length >= __MAX_TOASTS) {
      const old = __toasts.shift();
      try { old.close(); } catch (e) {}
    }
    const inst = ElementPlus.ElMessage({ type, message: text, duration: 1500, offset: 70, grouping: false, ...(opts || {}) });
    __toasts.push({ text, t: now, close: () => inst && inst.close && inst.close() });
  }
  const ElMessage = {
    success: (m, o) => __toast('success', m, o),
    warning: (m, o) => __toast('warning', m, o),
    error: (m, o) => __toast('error', m, o),
    info: (m, o) => __toast('info', m, o)
  };

  // ---------- 两个 axios 实例（用户 / 管理员，各自带 token） ----------
  const userApi = axios.create({ baseURL: '/api' });
  userApi.interceptors.request.use((c) => {
    const t = localStorage.getItem('token');
    if (t) c.headers.Authorization = 'Bearer ' + t;
    return c;
  });
  const adminApi = axios.create({ baseURL: '/api' });
  adminApi.interceptors.request.use((c) => {
    const t = localStorage.getItem('adminToken');
    if (t) c.headers.Authorization = 'Bearer ' + t;
    return c;
  });

  async function call(ins, method, url, data) {
    try {
      // 调用方用 U('get', url, { params: {...} }) 传查询参数。
      // 注意：不能把 { params } 直接当 data 传 —— axios 对 GET 会忽略请求体，
      // 查询串就永远不会拼上（分类筛选 / 搜索 / 分页 / 各种 limit 会集体失效）。
      const cfg = { method, url };
      if (data && data.params) {
        cfg.params = data.params;
        const rest = { ...data };
        delete rest.params;
        if (Object.keys(rest).length) cfg.data = rest;
      } else if (data !== undefined) {
        cfg.data = data;
      }
      const r = await ins.request(cfg);
      const d = r.data;
      if (d && d.code === 401) {
        if (ins === userApi) { store.token = ''; localStorage.removeItem('token'); }
        else { store.adminToken = ''; localStorage.removeItem('adminToken'); }
        ElMessage.warning(d.msg || '登录已过期');
      } else if (d && d.code !== 0 && d.msg) {
        // 任何非成功响应都必须让用户“看得见”，绝不静默失败
        ElMessage.error(d.msg);
      }
      return d;
    } catch (e) {
      const msg = (e.response && e.response.data && e.response.data.msg) || '网络错误，请确认后端已启动';
      ElMessage.error(msg);
      return { code: -1, msg };
    }
  }
  const U = (m, u, d) => call(userApi, m, u, d);
  const A = (m, u, d) => call(adminApi, m, u, d);

  // ---------- 全局状态 / 路由 ----------
  const store = reactive({
    token: localStorage.getItem('token') || '',
    user: null,
    adminToken: localStorage.getItem('adminToken') || '',
    adminName: localStorage.getItem('adminName') || '',
    searchInput: '',   // 搜索框里的草稿，不点"搜索"不会触发查询
    keywords: [],      // 已确认的搜索关键词（可多个，每个都能单独 × 掉）
    searchTick: 0      // 点搜索/删关键词后自增，首页监听它重新查询
  });
  // 管理员是一份「独立账号」：进后台 = 切换身份，此时前台用户能力全部关闭
  const isAdminMode = () => !!store.adminToken;
  const ADMIN_VIEWS = ['home', 'notice', 'admin'];    // 管理员模式下允许停留的页面
  function adminLogout() {
    store.adminToken = ''; store.adminName = '';
    localStorage.removeItem('adminToken'); localStorage.removeItem('adminName');
    ElMessage.success('已退出管理员登录');
    go('home');
  }
  const route = reactive({ name: 'home', params: {} });

  function go(name, params) {
    route.name = name;
    route.params = params || {};
    let h = '#/';
    if (name !== 'home') {
      h += name + (params && params.id ? '/' + params.id : '');
      // 除 id 外的参数必须编进查询串：否则改 hash 触发 hashchange 后 parseHash 会把它们清空，
      // 导致「私信卖家」带来的 userId 丢失、会话无法自动打开（编进 URL 后刷新也能恢复）
      const q = Object.keys(params || {}).filter(k => k !== 'id')
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
      if (q) h += '?' + q;
    }
    if (location.hash !== h) location.hash = h;
  }
  function parseHash() {
    let h = (location.hash || '').replace(/^#\/?/, '');
    const qi = h.indexOf('?');
    const query = {};
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(kv => {
        if (!kv) return;
        const eq = kv.indexOf('=');
        const k = decodeURIComponent(eq >= 0 ? kv.slice(0, eq) : kv);
        const v = decodeURIComponent(eq >= 0 ? kv.slice(eq + 1) : '');
        if (k) query[k] = v;
      });
      h = h.slice(0, qi);
    }
    const parts = h.split('/').filter(Boolean);
    if (!parts.length) { route.name = 'home'; route.params = {}; }
    else {
      route.name = parts[0];
      route.params = { ...query };
      if (parts[1] !== undefined && parts[1] !== '') route.params.id = parts[1];
    }
  }
  window.addEventListener('hashchange', parseHash);
  parseHash();

  const isLogin = () => !!store.token;
  function requireLogin() {
    if (!isLogin()) { ElMessage.warning('请先登录'); go('login'); return false; }
    return true;
  }
  const money = (n) => '¥' + (Number(n) || 0).toFixed(2);

  // ---------- 手机号校验：统一 11 位规则（注册 / 个人资料 / 收货地址共用） ----------
  // 返回 { ok, level, msg }，level 用于决定提示颜色：warn=还差位数，error=不符合，ok=通过
  function checkPhone(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return { ok: false, level: 'warn', msg: '请输入手机号（11 位）' };
    if (!/^\d+$/.test(s)) return { ok: false, level: 'error', msg: '手机号只能是数字，请去掉字母、空格或符号' };
    if (s.length < 11) return { ok: false, level: 'warn', msg: `手机号需 11 位，还差 ${11 - s.length} 位` };
    if (s.length > 11) return { ok: false, level: 'error', msg: `手机号超出 11 位（当前 ${s.length} 位），请检查是否多输` };
    return { ok: true, level: 'ok', msg: '手机号格式正确' };
  }
  // 输入时只保留数字，避免中英文、空格、横线混入（粘贴 138-0000-0001 也能自动纠正）
  function digitsOnly(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
  // 账号去空格：空格不算有效字符（" a d m i n " 会被纠正成 "admin"）
  function noSpace(v) { return String(v == null ? '' : v).replace(/\s+/g, ''); }
  // 供模板使用：非空时才给提示对象
  const phoneTipOf = (v) => (String(v || '').trim() ? checkPhone(v) : null);

  // ---------- 搜索：确认后才查询，关键词以可关闭标签形式存在 ----------
  const MAX_KEYWORDS = 5;
  function splitKeywords(v) {
    return String(v == null ? '' : v).split(/[\s,，、;；]+/).map((s) => s.trim()).filter(Boolean);
  }
  // 点"搜索"或回车：把输入里的词加进关键词列表（支持空格/逗号分隔多个），并触发首页查询
  function doSearch(raw) {
    const add = splitKeywords(raw === undefined ? store.searchInput : raw);
    if (!add.length) { ElMessage.warning('请输入搜索关键词'); return; }
    const next = store.keywords.slice();
    add.forEach((k) => { if (next.indexOf(k) === -1 && next.length < MAX_KEYWORDS) next.push(k); });
    store.keywords = next;
    store.searchInput = '';
    store.searchTick++;
    if (route.name !== 'home') go('home');   // 已在首页就停在原地，不跳转
  }
  function removeKeyword(k) {
    store.keywords = store.keywords.filter((x) => x !== k);
    store.searchTick++;
  }
  function clearKeywords() {
    store.keywords = [];
    store.searchTick++;
  }

  // 商品没有上传图片时：按类目生成一张 SVG 封面图，避免整站"没有图片"的观感
  const COVER_TINTS = {
    1: ['#fcd34d', '#f59e0b'], 2: ['#93c5fd', '#2563eb'], 3: ['#86efac', '#16a34a'],
    4: ['#fda4af', '#e11d48'], 5: ['#a5b4fc', '#4f46e5'], 6: ['#f9a8d4', '#db2777'],
    7: ['#67e8f9', '#0891b2'], 8: ['#fdba74', '#ea580c']
  };
  const xmlEsc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  function makeCover(title, catName, catId) {
    const t = COVER_TINTS[catId] || ['#fdba74', '#f97316'];
    const ch = xmlEsc(String(title || '宝').trim().charAt(0) || '宝');
    const sub = xmlEsc(String(catName || '校园二手').slice(0, 6));
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + t[0] + '"/><stop offset="1" stop-color="' + t[1] + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="320" height="240" fill="url(#g)"/>' +
      '<circle cx="268" cy="48" r="62" fill="#ffffff" fill-opacity="0.16"/>' +
      '<circle cx="46" cy="206" r="48" fill="#ffffff" fill-opacity="0.12"/>' +
      '<text x="160" y="126" font-size="104" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-weight="700" fill="#ffffff" fill-opacity="0.96" text-anchor="middle">' + ch + '</text>' +
      '<text x="160" y="200" font-size="19" font-family="PingFang SC,Microsoft YaHei,sans-serif" fill="#ffffff" fill-opacity="0.88" text-anchor="middle">' + sub + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // ---------- 公共：商品卡片 ----------
  const ProductCard = {
    props: { product: { type: Object, required: true } },
    setup(props) {
      const first = (s) => (s && s.trim()) ? s.trim().charAt(0) : '宝';
      async function addCart() {
        if (!requireLogin()) return;
        const d = await U('post', '/cart/add', { product_id: props.product.id, quantity: 1 });
        if (d.code === 0) ElMessage.success('已加入购物车');
      }
      async function fav() {
        if (!requireLogin()) return;
        const d = await U('post', '/product/favorite/' + props.product.id);
        if (d.code === 0) ElMessage.success('已收藏，将影响你的推荐');
      }
      // 管理员只是浏览平台数据：卡片上不出现任何购买入口
      const isAdmin = computed(() => isAdminMode());
      // 有上传图片就用真实图片，没有就自动生成一张封面
      const genCover = computed(() => makeCover(props.product.title, props.product.category_name, props.product.category_id));
      const imgFailed = ref(false);
      // 有上传/外链图片就先用它；加载失败（断网等）自动回退到本地生成的封面
      const cover = computed(() => (imgFailed.value ? genCover.value : (props.product.cover || genCover.value)));
      function open() { if (isAdmin.value) return; go('product', { id: props.product.id }); }
      return { first, addCart, fav, open, money, isAdmin, cover, imgFailed };
    },
    template: `
      <div class="card" @click="open">
        <div class="cover">
          <img v-if="cover" :src="cover" :alt="product.title" loading="lazy" @error="imgFailed = true" />
          <template v-else>{{ first(product.title) }}</template>
        </div>
        <div class="body">
          <div class="title">{{ product.title }}</div>
          <div class="reco-reason" v-if="product.reason">{{ product.reason }}</div>
          <div class="meta">
            <span class="price"><small>¥</small>{{ (Number(product.price)||0).toFixed(2) }}</span>
            <span class="cat-tag">{{ product.category_name || '未分类' }}</span>
          </div>
          <div class="row" style="margin-top:8px" @click.stop v-if="!isAdmin">
            <el-button size="small" type="primary" @click="addCart">加购</el-button>
            <el-button size="small" @click="fav">收藏</el-button>
          </div>
          <div v-else class="admin-only-tip">管理员浏览模式 · 不可下单</div>
        </div>
      </div>`
  };

  // ---------- 登录 / 注册 ----------
  const Login = {
    setup() {
      const form = reactive({ mode: 'login', username: '', password: '', nickname: '', email: '', phone: '' });
      const formRef = ref(null);
      const pwdRef = ref(null);
      const shake = ref(false);
      const loading = ref(false);
      const errMsg = ref('');   // 卡片内再留一条文字提示，避免只弹浮层被错过
      const rules = {
        username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
        password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
      };
      const phoneTip = computed(() => phoneTipOf(form.phone));

      // 失败反馈：卡片轻微抖动（视觉提示）+ 顶部浮层（唯一文字提示），只弹一个
      function warnFail(msg) {
        shake.value = false;
        nextTick(() => { shake.value = true; setTimeout(() => (shake.value = false), 620); });
        ElMessage.error(msg || '账号或密码不正确');
      }
      function validateForm() {
        return new Promise((resolve) => {
          if (!formRef.value) return resolve(true);
          formRef.value.validate((valid) => resolve(!!valid));
        });
      }
      async function doLogin() {
        errMsg.value = '';
        if (!(await validateForm())) return;
        // 账号里的空格不算有效字符：先规整，纯空格直接拦下
        const uname = noSpace(form.username);
        form.username = uname;
        if (!uname) { warnFail('请输入账号（不能只输入空格）'); return; }
        // 管理员账号不属于前台「普通用户」登录通道：给出明确指引并直接跳到后台入口
        if (uname.toLowerCase() === 'admin') {
          ElMessage.warning('管理员请使用「后台管理」入口登录，正在为你跳转…');
          go('admin');
          return;
        }
        loading.value = true;
        const d = await U('post', '/auth/login', { username: uname, password: form.password });
        loading.value = false;
        if (d.code === 0) {
          store.token = d.data.token; localStorage.setItem('token', d.data.token);
          store.user = d.data.user;
          ElMessage.success('登录成功'); go('home');
        } else {
          warnFail(d.msg);
          form.password = '';          // 只清密码、保留账号，方便直接重输
          nextTick(() => pwdRef.value && pwdRef.value.focus());
        }
      }
      async function doRegister() {
        errMsg.value = '';
        const uname = noSpace(form.username);
        form.username = uname;
        if (!uname) { warnFail('请输入账号（不能只输入空格）'); return; }
        const cp = phoneTipOf(form.phone);
        if (cp && !cp.ok) { warnFail(cp.msg); return; }
        loading.value = true;
        const d = await U('post', '/auth/register', { username: uname, password: form.password, nickname: form.nickname, email: form.email, phone: form.phone });
        loading.value = false;
        if (d.code === 0) { ElMessage.success('注册成功，请登录'); form.mode = 'login'; form.password = ''; }
        else warnFail(d.msg);
      }
      // 一键体验：用演示账号登录，直接看到“猜你喜欢”
      async function quickDemo() {
        errMsg.value = '';
        loading.value = true;
        const d = await U('post', '/auth/login', { username: 'user001', password: '123456' });
        loading.value = false;
        if (d.code === 0) {
          store.token = d.data.token; localStorage.setItem('token', d.data.token);
          store.user = d.data.user;
          ElMessage.success('已以演示账号 user001 登录'); go('home');
        } else warnFail(d.msg || '演示账号登录失败，请重试');
      }
      watch(() => form.mode, () => { errMsg.value = ''; form.password = ''; });
      return { form, formRef, pwdRef, shake, loading, errMsg, rules, phoneTip, checkPhone, digitsOnly, noSpace, doLogin, doRegister, quickDemo, go };
    },
    template: `
      <div class="login-wrap" :class="{ shake: shake }">
        <h2 style="text-align:center;margin-top:0;color:#ea580c">校园二手优选</h2>
        <el-tabs v-model="form.mode">
          <el-tab-pane label="登录" name="login"></el-tab-pane>
          <el-tab-pane label="注册" name="register"></el-tab-pane>
        </el-tabs>
        <el-form ref="formRef" :model="form" :rules="rules" @submit.prevent>
          <el-form-item prop="username">
            <el-input v-model="form.username" placeholder="账号（不支持空格）" clearable @input="form.username = noSpace($event)" />
          </el-form-item>
          <el-form-item prop="password">
            <el-input ref="pwdRef" v-model="form.password" type="password" placeholder="密码" show-password
                      @keyup.enter="form.mode==='login' && doLogin()" />
          </el-form-item>
          <template v-if="form.mode==='register'">
            <el-form-item prop="nickname"><el-input v-model="form.nickname" placeholder="昵称（可选）" /></el-form-item>
            <el-form-item prop="email"><el-input v-model="form.email" placeholder="邮箱（可选）" /></el-form-item>
            <el-form-item prop="phone">
              <el-input v-model="form.phone" placeholder="手机号（11 位，可选）" @input="form.phone = digitsOnly($event)" />
            </el-form-item>
            <div v-if="phoneTip" class="field-hint" :class="'is-' + phoneTip.level" style="margin-top:-14px">{{ phoneTip.msg }}</div>
          </template>
          <el-button v-if="form.mode==='login'" type="primary" style="width:100%" :loading="loading" @click="doLogin">登 录</el-button>
          <el-button v-else type="primary" style="width:100%" :loading="loading" @click="doRegister">注 册</el-button>
        </el-form>
        <el-divider>不想注册？一键体验</el-divider>
        <el-button style="width:100%" :loading="loading" @click="quickDemo">以演示账号登录（看“猜你喜欢”）</el-button>
        <p style="font-size:12px;color:#909399;text-align:center;margin-top:14px">
          演示账号：user001 / 123456
        </p>
        <div style="text-align:center;margin-top:6px">
          <el-button text size="small" type="info" @click="go('admin')">我是管理员？进入后台</el-button>
        </div>
      </div>`
  };

  // ---------- 首页（含推荐位） ----------
  const Home = {
    setup() {
      const categories = ref([]);
      const products = ref([]);
      const recommend = ref([]);
      const basis = ref([]);
      const total = ref(0);
      const page = ref(1);
      const size = 12;
      const activeCat = ref(0);
      const loading = ref(true);

      async function loadCategories() {
        const d = await U('get', '/category/list');
        if (d.code === 0) categories.value = d.data;
      }
      async function loadProducts(p) {
        page.value = p || 1;
        loading.value = true;
        const d = await U('get', '/product/list', { params: { page: page.value, size, category_id: activeCat.value || '', keyword: store.keywords.join(' ') } });
        if (d.code === 0) { products.value = d.data.list; total.value = d.data.total; }
        loading.value = false;
      }
      async function loadRecommend() {
        if (!isLogin()) { recommend.value = []; basis.value = []; return; }
        const d = await U('get', '/recommend/for-you', { params: { limit: 8 } });
        if (d.code === 0) { recommend.value = d.data || []; basis.value = d.basis || []; }
      }
      function pickCat(id) { activeCat.value = id; loadProducts(1); }
      function onSearch() { loadProducts(1); }
      function onPage(p) { loadProducts(p); }
      function refreshReco() { loadRecommend(); }

      // 公告：管理员发布，所有访客 / 用户都能看到（首页只展示最新 2 条）
      const notices = ref([]);
      const isAdmin = computed(() => isAdminMode());
      async function loadNotices() {
        const d = await U('get', '/notice/list');
        if (d.code === 0) notices.value = (d.data || []).slice(0, 2);
      }

      // 搜索历史（我的）与热搜词（全站），点击即用该词搜索
      const myKeywords = ref([]);
      const hotKeywords = ref([]);
      async function loadMine() {
        if (!isLogin()) { myKeywords.value = []; return; }
        const d = await U('get', '/search/mine');
        if (d.code === 0) myKeywords.value = d.data || [];
      }
      async function loadHot() {
        const d = await U('get', '/search/hot', { params: { limit: 8 } });
        if (d.code === 0) hotKeywords.value = d.data || [];
      }
      async function clearMine() {
        const d = await U('delete', '/search/mine');
        if (d.code === 0) { myKeywords.value = []; }
      }
      // 点历史/热搜标签 = 直接作为关键词搜索（也走"确认后才查"的逻辑）
      function useKeyword(k) { doSearch(k); }
      const keywords = computed(() => store.keywords);
      function removeKw(k) { removeKeyword(k); }
      function clearKw() { clearKeywords(); }
      // 空状态里的"去发布一个吧"超链接：登录了直接去发布页，没登录先去登录
      function goPublish() {
        if (!isLogin()) { ElMessage.warning('登录后即可发布商品'); go('login'); return; }
        go('publish');
      }
      let lastLogged = '';
      async function logSearch(kw) {
        const k = String(kw || '').trim();
        if (!k || k === lastLogged || !isLogin()) return;
        lastLogged = k;
        await U('post', '/search/log', { keyword: k });
        loadMine(); loadHot();
      }

      onMounted(() => { loadCategories(); loadProducts(1); loadRecommend(); loadNotices(); loadMine(); loadHot(); });
      // 只有"确认搜索/删关键词"（searchTick 变化）才重新查询，输入框打字不再实时过滤
      watch(() => store.searchTick, () => { loadProducts(1); logSearch(store.keywords.join(' ')); });
      watch(() => store.token, () => loadRecommend());

      return { categories, products, recommend, basis, total, activeCat, loading, pickCat, onSearch, onPage, refreshReco, money, go, isLogin, notices, isAdmin, myKeywords, hotKeywords, useKeyword, clearMine, keywords, removeKw, clearKw, goPublish };
    },
    template: `
      <div class="container">
        <div class="notice-board" v-if="notices.length">
          <span class="nb-tag">公告</span>
          <div style="flex:1;min-width:0">
            <div class="nb-item" v-for="n in notices" :key="n.id" @click="go('notice')">
              <b>{{ n.title }}</b><span>{{ n.content }}</span>
            </div>
          </div>
          <a class="nb-more" @click="go('notice')">全部 ›</a>
        </div>

        <div class="reco" v-if="isLogin() && !keywords.length">
          <div class="section-title"><span class="bar"></span>猜你喜欢{{ basis.length ? ' · 基于你收藏的「' + basis.join('、') + '」' : ' · 基于协同过滤算法' }}</div>
          <div class="hint">根据你和其他同学的浏览 / 收藏 / 购买行为，实时计算商品相似度后推荐。</div>
          <div class="grid">
            <product-card v-for="p in recommend" :key="'r'+p.id" :product="p" />
          </div>
        </div>
        <el-alert v-else-if="isAdmin && !keywords.length" title="当前为管理员身份" type="info" :closable="false" style="margin-bottom:12px">
          <template #default><span>管理员只负责平台管理：可访问 首页 / 公告 / 后台；购物车、订单、私信等属于普通用户。</span></template>
        </el-alert>
        <el-alert v-else-if="!keywords.length" title="登录后即可查看个性化推荐「猜你喜欢」" type="info" :closable="false" style="margin-bottom:12px">
          <template #default><span>顶部「以演示账号登录」可一键体验推荐效果。</span></template>
        </el-alert>

        <div class="search-tags" v-if="myKeywords.length || hotKeywords.length">
          <div class="st-row" v-if="myKeywords.length">
            <span class="st-label">最近搜索</span>
            <el-tag v-for="(k,i) in myKeywords" :key="'m'+i" size="small" class="st-tag" @click="useKeyword(k)">{{ k }}</el-tag>
            <el-button text size="small" type="info" @click="clearMine">清空</el-button>
          </div>
          <div class="st-row" v-if="hotKeywords.length">
            <span class="st-label">大家都在搜</span>
            <el-tag v-for="(h,i) in hotKeywords" :key="'h'+i" size="small" type="warning" effect="plain" class="st-tag" @click="useKeyword(h.keyword)">{{ h.keyword }}<span v-if="h.count>1" class="st-count"> {{ h.count }}</span></el-tag>
          </div>
        </div>

        <div class="kw-bar" v-if="keywords.length">
          <span class="st-label">当前搜索</span>
          <el-tag v-for="k in keywords" :key="k" closable size="small" type="primary" class="kw-chip" @close="removeKw(k)">{{ k }}</el-tag>
          <el-button text size="small" type="info" @click="clearKw">清空</el-button>
          <span class="kw-tip">命中任意一个关键词就会显示，全部命中的排在最前；点标签上的 × 可取消该关键词</span>
        </div>

        <div class="section-title"><span class="bar"></span>{{ keywords.length ? '搜索结果 · 共 ' + total + ' 件' : '全部商品' }}</div>
        <div class="row" style="margin-bottom:12px">
          <el-button :type="activeCat===0?'primary':'default'" size="small" @click="pickCat(0)">全部</el-button>
          <el-button v-for="c in categories" :key="c.id" :type="activeCat===c.id?'primary':'default'" size="small" @click="pickCat(c.id)">{{ c.name }}</el-button>
        </div>

        <div v-if="loading && !products.length" class="grid">
          <div class="sk-card" v-for="n in 8" :key="'sk'+n">
            <div class="sk-cover shimmer"></div>
            <div class="sk-body"><div class="sk-line shimmer"></div><div class="sk-line short shimmer"></div></div>
          </div>
        </div>
        <div v-else-if="products.length" class="grid">
          <product-card v-for="p in products" :key="p.id" :product="p" />
        </div>
        <div v-else class="empty">暂无商品，<a class="link-go" @click="goPublish">去发布一个吧～</a></div>

        <div style="text-align:center;margin:20px 0" v-if="total>12">
          <el-pagination layout="prev,pager,next" :total="total" :page-size="12" @current-change="onPage" />
        </div>
      </div>`
  };

  // ---------- 商品详情 ----------
  const ProductDetail = {
    setup() {
      const id = route.params.id;
      const product = ref({});
      const loading = ref(true);
      async function load() {
        const d = await U('get', '/product/detail/' + id);
        if (d.code === 0) product.value = d.data;
        else if (d.code === 401) go('login');
        loading.value = false;
      }
      async function addCart() {
        if (!requireLogin()) return;
        const d = await U('post', '/cart/add', { product_id: id, quantity: 1 });
        if (d.code === 0) ElMessage.success('已加入购物车');
      }
      function buyNow() {
        if (!requireLogin()) return;
        addCart();
        go('cart');
      }
      function talk() {
        if (!requireLogin()) return;
        go('messages', { userId: product.value.seller_id, name: product.value.seller_name || '' });
      }
      function back() { go('home'); }
      // 图片：cover 优先，其次 images 数组
      const genCover = computed(() => {
        const p = product.value || {};
        return makeCover(p.title, p.category_name, p.category_id);
      });
      const imgs = computed(() => {
        const p = product.value || {};
        const arr = (p.images || []).filter(Boolean);
        const list = p.cover ? [p.cover].concat(arr.filter((u) => u !== p.cover)) : arr;
        return list.length ? list : [genCover.value];   // 一张图都没有时用生成的封面
      });
      const cur = ref('');
      watch(imgs, (v) => { cur.value = v[0] || ''; }, { immediate: true });
      const curImg = computed(() => cur.value || imgs.value[0] || genCover.value);
      function setImg(u) { cur.value = u; }
      onMounted(load);
      return { product, loading, addCart, buyNow, talk, back, money, imgs, curImg, setImg };
    },
    template: `
      <div class="container" v-loading="loading">
        <el-button text @click="back" style="margin-bottom:10px">← 返回</el-button>
        <div class="row" style="align-items:flex-start">
          <div class="detail-img">
            <img v-if="curImg" :src="curImg" :alt="product.title" />
            <template v-else>{{ (product.title||'宝').charAt(0) }}</template>
          </div>
          <div class="row thumb-row" v-if="imgs.length > 1">
            <img v-for="(u,i) in imgs" :key="i" :src="u" class="thumb" :class="{active: curImg===u}" @click="setImg(u)" />
          </div>
          <div style="flex:1;min-width:280px">
            <h2 style="margin:0 0 8px">{{ product.title }}</h2>
            <div style="color:#f56c6c;font-size:26px;font-weight:700;margin-bottom:8px">{{ money(product.price) }}</div>
            <p style="color:#909399">分类：{{ product.category_name }}　|　库存：{{ product.stock }}　|　卖家：{{ product.seller_name }}</p>
            <p style="line-height:1.7;color:#606266">{{ product.description || '暂无描述' }}</p>
            <div class="row" style="margin-top:16px">
              <el-button type="primary" size="large" @click="addCart">加入购物车</el-button>
              <el-button type="danger" size="large" @click="buyNow">立即购买</el-button>
              <el-button size="large" @click="talk">私信卖家</el-button>
            </div>
          </div>
        </div>
      </div>`
  };

  // ---------- 购物车 ----------
  const Cart = {
    setup() {
      const items = ref([]);
      const addrVisible = ref(false);
      const addresses = ref([]);
      const selAddr = ref(0);
      async function load() {
        if (!requireLogin()) return;
        const d = await U('get', '/cart/list');
        if (d.code === 0) items.value = d.data;
      }
      function subtotal() { return items.value.reduce((s, i) => s + Number(i.price) * i.quantity, 0); }
      async function chgQty(row) { await U('put', '/cart/update/' + row.id, { quantity: row.quantity }); load(); }
      async function del(row) { await U('delete', '/cart/' + row.id); load(); }
      async function openCheckout() {
        const d = await U('get', '/user/address');
        if (d.code === 0) { addresses.value = d.data; selAddr.value = (d.data.find(a => a.is_default) || d.data[0] || {}).id || 0; }
        addrVisible.value = true;
      }
      async function pay() {
        if (!selAddr.value) { ElMessage.warning('请先选择或新增收货地址'); return; }
        const d = await U('post', '/order/create', { items: items.value.map(i => ({ product_id: i.product_id, quantity: i.quantity })), address_id: selAddr.value });
        if (d.code === 0) { ElMessage.success('下单成功，合计 ' + money(d.data.total)); addrVisible.value = false; load(); go('orders'); }
      }
      onMounted(load);
      return { items, addrVisible, addresses, selAddr, subtotal, chgQty, del, openCheckout, pay, money };
    },
    template: `
      <div class="container">
        <div class="section-title"><span class="bar"></span>我的购物车</div>
        <el-table v-if="items.length" :data="items" border>
          <el-table-column label="商品" min-width="200">
            <template #default="{row}"><b>{{ row.title }}</b><div style="color:#909399;font-size:12px">{{ row.status===1?'在售':'已下架' }}</div></template>
          </el-table-column>
          <el-table-column label="单价" width="110"><template #default="{row}">{{ money(row.price) }}</template></el-table-column>
          <el-table-column label="数量" width="130">
            <template #default="{row}">
              <el-input-number v-model="row.quantity" :min="1" :max="row.stock||99" @change="chgQty(row)" />
            </template>
          </el-table-column>
          <el-table-column label="小计" width="110"><template #default="{row}">{{ money(row.price*row.quantity) }}</template></el-table-column>
          <el-table-column label="操作" width="100"><template #default="{row}"><el-button type="danger" text @click="del(row)">删除</el-button></template></el-table-column>
        </el-table>
        <div v-else class="empty">购物车是空的，去首页逛逛吧～</div>

        <div v-if="items.length" style="text-align:right;margin-top:16px">
          <span style="font-size:16px">合计：<b style="color:#f56c6c;font-size:22px">{{ money(subtotal()) }}</b></span>
          <el-button type="primary" size="large" style="margin-left:16px" @click="openCheckout">去结算</el-button>
        </div>

        <el-dialog v-model="addrVisible" title="选择收货地址">
          <el-radio-group v-model="selAddr">
            <div v-for="a in addresses" :key="a.id" style="margin:6px 0">
              <el-radio :value="a.id">{{ a.name }} {{ a.phone }} — {{ a.detail }}<span v-if="a.is_default">（默认）</span></el-radio>
            </div>
          </el-radio-group>
          <div v-if="!addresses.length" style="color:#909399">暂无地址，请到「个人中心」添加。</div>
          <template #footer><el-button type="primary" @click="pay">确认下单</el-button></template>
        </el-dialog>
      </div>`
  };

  // ---------- 订单 ----------
  const Orders = {
    setup() {
      const orders = ref([]);
      const statusText = ['待付款', '已付款', '已发货·待收货', '已完成', '已取消'];
      async function load() {
        if (!requireLogin()) return;
        const d = await U('get', '/order/list');
        if (d.code === 0) orders.value = d.data;
      }
      async function pay(o) { await U('put', '/order/pay/' + o.id); load(); }
      async function confirm(o) { await U('put', '/order/confirm/' + o.id); load(); }
      async function cancel(o) { await U('put', '/order/cancel/' + o.id); load(); }
      onMounted(load);
      return { orders, statusText, pay, confirm, cancel, money, go };
    },
    template: `
      <div class="container">
        <div class="section-title"><span class="bar"></span>我的订单</div>
        <div v-if="orders.length">
          <el-card v-for="o in orders" :key="o.id" style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>订单号：{{ o.order_no }}　|　状态：<el-tag :type="['warning','success','','info','info'][o.status]">{{ statusText[o.status] }}</el-tag></div>
              <div>合计：<b style="color:#f56c6c">{{ money(o.total) }}</b></div>
            </div>
            <el-table :data="o.items" size="small" style="margin-top:8px">
              <el-table-column prop="title" label="商品" />
              <el-table-column prop="price" label="单价" width="100"><template #default="{row}">{{ money(row.price) }}</template></el-table-column>
              <el-table-column prop="quantity" label="数量" width="80" />
            </el-table>
            <div style="margin-top:8px">
              <el-button v-if="o.status===0" type="success" size="small" @click="pay(o)">付款</el-button>
              <el-tag v-if="o.status===1" type="info" size="small">等待卖家发货</el-tag>
              <el-button v-if="o.status===2" type="primary" size="small" @click="confirm(o)">确认收货</el-button>
              <el-button v-if="o.status===0" text type="danger" size="small" @click="cancel(o)">取消订单</el-button>
            </div>
          </el-card>
        </div>
        <div v-else class="empty">还没有订单。</div>
      </div>`
  };

  // ---------- 我卖出的（商户视角：看买家下的单 + 收货地址） ----------
  const SoldOrders = {
    setup() {
      const orders = ref([]);
      const statusText = ['待付款', '已付款', '已发货·待收货', '已完成', '已取消'];
      async function load() {
        if (!requireLogin()) return;
        const d = await U('get', '/order/sold');
        if (d.code === 0) orders.value = d.data;
      }
      onMounted(load);
      async function ship(o) { await U('put', '/order/ship/' + o.id); load(); }
      return { orders, statusText, ship, money, go };
    },
    template: `
      <div class="container">
        <div class="section-title"><span class="bar"></span>我卖出的（买家订单）</div>
        <div v-if="orders.length">
          <el-card v-for="o in orders" :key="o.id" style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>订单号：{{ o.order_no }}　|　状态：<el-tag :type="['warning','success','','info','info'][o.status]">{{ statusText[o.status] }}</el-tag></div>
              <div>合计：<b style="color:#f56c6c">{{ money(o.total) }}</b></div>
            </div>
            <el-table :data="o.items" size="small" style="margin-top:8px">
              <el-table-column prop="title" label="商品" />
              <el-table-column prop="price" label="单价" width="100"><template #default="{row}">{{ money(row.price) }}</template></el-table-column>
              <el-table-column prop="quantity" label="数量" width="80" />
            </el-table>
            <div style="margin-top:8px;padding:8px 10px;background:#faf3ee;border-radius:8px;color:#7a5a3a">
              买家：{{ o.buyer_name || '—' }}　|　电话：{{ o.buyer_phone || '—' }}　|　收货地址：{{ o.buyer_address || '—' }}
            </div>
            <div v-if="o.status===0" style="margin-top:8px"><el-tag type="info" size="small">等待买家付款</el-tag></div>
            <div v-if="o.status===1" style="margin-top:8px"><el-button type="primary" size="small" @click="ship(o)">发货</el-button></div>
          </el-card>
        </div>
        <div v-else class="empty">还没有同学购买你发布的商品。</div>
      </div>`
  };

  // ---------- 发布商品 ----------
  const Publish = {
    setup() {
      const categories = ref([]);
      const form = reactive({ title: '', description: '', price: '', stock: '', category_id: '' });
      const uploading = ref(false);
      const images = ref([]);            // 已上传成功的图片地址（第一张作封面）
      const fileInput = ref(null);
      async function loadCats() { const d = await U('get', '/category/list'); if (d.code === 0) categories.value = d.data; }
      async function onPick(e) {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        if (!requireLogin()) { e.target.value = ''; return; }
        const room = 6 - images.value.length;
        if (room <= 0) { ElMessage.warning('最多 6 张图片'); e.target.value = ''; return; }
        uploading.value = true;
        for (const f of files.slice(0, room)) {
          const fd = new FormData();
          fd.append('images', f);
          const d = await U('post', '/product/image', fd);
          if (d && d.code === 0) images.value = images.value.concat(d.data || []);
          else ElMessage.error((d && d.msg) || '图片上传失败');
        }
        uploading.value = false;
        e.target.value = '';
      }
      function delImg(i) { images.value.splice(i, 1); }
      async function submit() {
        if (!requireLogin()) return;
        if (!form.title || !form.price) { ElMessage.warning('标题和价格必填'); return; }
        if (!form.category_id) { ElMessage.warning('请选择商品分类'); return; }
        uploading.value = true;
        const fd = new FormData();
        fd.append('title', form.title);
        fd.append('description', form.description);
        fd.append('price', form.price);
        fd.append('stock', form.stock);
        fd.append('category_id', form.category_id);
        fd.append('images', JSON.stringify(images.value));
        let d;
        try {
          d = await userApi.request({ method: 'post', url: '/product/publish', data: fd });
        } catch (e) {
          uploading.value = false;
          ElMessage.error((e.response && e.response.data && e.response.data.msg) || '发布失败，请稍后重试或重新登录');
          return;
        }
        uploading.value = false;
        if (d.data && d.data.code === 0) { ElMessage.success('发布成功'); go('home'); }
        else ElMessage.error((d.data && d.data.msg) || '发布失败');
      }
      onMounted(loadCats);
      return { categories, form, onPick, delImg, submit, uploading, images, fileInput };
    },
    template: `
      <div class="container" style="max-width:640px">
        <div class="section-title"><span class="bar"></span>发布二手商品</div>
        <el-card>
          <el-input v-model="form.title" placeholder="商品标题" style="margin-bottom:12px" />
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="商品描述" style="margin-bottom:12px" />
          <div class="row" style="margin-bottom:12px">
            <el-input v-model="form.price" placeholder="价格（元）" style="width:160px" />
            <el-input v-model="form.stock" placeholder="库存" style="width:140px" />
            <el-select v-model="form.category_id" placeholder="选择分类" style="width:180px">
              <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </div>
          <div style="margin-bottom:12px">
            <div style="font-size:13px;color:#7c2d12;margin-bottom:6px">商品图片（选填，最多 6 张，第一张作封面）</div>
            <input ref="fileInput" type="file" accept="image/*" multiple @change="onPick" style="display:none" />
            <el-button @click="fileInput.click()" :loading="uploading">+ 选择图片</el-button>
            <span style="font-size:12px;color:#b08968;margin-left:8px">支持 jpg / png，单张不超过 5MB</span>
            <div class="row thumb-row" v-if="images.length" style="margin-top:10px">
              <div class="thumb-wrap" v-for="(u,i) in images" :key="i">
                <img :src="u" class="thumb" />
                <span class="thumb-del" @click="delImg(i)">×</span>
                <span class="thumb-flag" v-if="i===0">封面</span>
              </div>
            </div>
          </div>
          <el-button type="primary" :loading="uploading" @click="submit">发布商品</el-button>
        </el-card>
      </div>`
  };

  // ---------- 私信 ----------
  const Messages = {
    setup() {
      const contacts = ref([]);
      const talks = ref([]);
      const content = ref('');
      const curId = ref(0);
      const curName = ref('');
      async function loadContacts() {
        if (!requireLogin()) return;
        const d = await U('get', '/message/contacts');
        if (d.code === 0) { contacts.value = d.data; if (route.params.userId) openTalk(route.params.userId, route.params.name || ''); }
      }
      async function openTalk(uid, name) {
        curId.value = Number(uid); curName.value = name || '';
        const d = await U('get', '/message/talk/' + uid);
        if (d.code === 0) talks.value = d.data;
        await nextTick();
      }
      async function send() {
        if (!content.value.trim()) return;
        const d = await U('post', '/message/send', { to_id: curId.value, content: content.value });
        if (d.code === 0) { content.value = ''; openTalk(curId.value, curName.value); }
      }
      onMounted(loadContacts);
      return { contacts, talks, content, curId, curName, openTalk, send, go };
    },
    template: `
      <div class="container">
        <div class="section-title"><span class="bar"></span>站内私信</div>
        <div class="row" style="align-items:flex-start">
          <el-card style="width:240px;min-height:360px">
            <div v-if="!contacts.length" class="empty">暂无会话</div>
            <div v-for="c in contacts" :key="c.contact_id" class="card" style="margin-bottom:8px;cursor:pointer" :style="curId===c.contact_id?'border-color:#f97316':''" @click="openTalk(c.contact_id, c.nickname)">
              <div style="padding:8px 10px"><b>{{ c.nickname }}</b><div style="color:#909399;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ c.last_msg }}</div></div>
            </div>
          </el-card>
          <el-card style="flex:1;min-height:360px">
            <template v-if="curId">
              <div style="height:240px;overflow:auto;background:#fff7ed;border-radius:8px;padding:10px">
                <div v-for="(m,i) in talks" :key="i" style="margin:6px 0" :style="{textAlign: m.from_id===userMe?'right':'left'}">
                  <span style="display:inline-block;padding:6px 10px;border-radius:8px" :style="{background: m.from_id===userMe?'#f97316':'#fff', color: m.from_id===userMe?'#fff':'#4a3f35'}">{{ m.content }}</span>
                </div>
              </div>
              <div class="row" style="margin-top:10px">
                <el-input v-model="content" placeholder="输入消息，回车发送" @keyup.enter="send" style="flex:1" />
                <el-button type="primary" @click="send">发送</el-button>
              </div>
            </template>
            <div v-else class="empty">选择一个会话开始聊天</div>
          </el-card>
        </div>
      </div>`,
    // 补充：当前用户 id 用于气泡左右
    data() {
      let me = 0;
      try {
        const t = (localStorage.getItem('token') || '').split('.')[1] || '{}';
        me = Number(JSON.parse(atob(t)).id) || 0;
      } catch (e) {}
      return { userMe: me };
    }
  };

  // ---------- 个人中心 ----------
  const Profile = {
    setup() {
      const profile = reactive({ nickname: '', email: '', phone: '' });
      const addresses = ref([]);
      const addrVisible = ref(false);
      const addrForm = reactive({ name: '', phone: '', detail: '', is_default: false });
      const profileTip = computed(() => phoneTipOf(profile.phone));
      const addrPhoneTip = computed(() => phoneTipOf(addrForm.phone));
      async function load() {
        if (!requireLogin()) return;
        const d = await U('get', '/user/profile');
        if (d.code === 0) Object.assign(profile, d.data);
        const a = await U('get', '/user/address');
        if (a.code === 0) addresses.value = a.data;
      }
      async function save() {
        const cp = phoneTipOf(profile.phone);
        if (cp && !cp.ok) { ElMessage.warning(cp.msg); return; }
        const d = await U('put', '/user/profile', { ...profile });
        if (d.code === 0) ElMessage.success('已保存');
      }
      function openAddr() { Object.assign(addrForm, { name: '', phone: '', detail: '', is_default: false }); addrVisible.value = true; }
      // 保存前逐项拦下来，并把原因说清楚（不让人对着没反应的按钮发懵）
      async function saveAddr() {
        if (!String(addrForm.name).trim()) { ElMessage.warning('请填写收货人姓名'); return; }
        const cp = checkPhone(addrForm.phone);
        if (!cp.ok) { ElMessage.warning(cp.msg); return; }
        if (!String(addrForm.detail).trim()) { ElMessage.warning('请填写详细地址'); return; }
        const d = await U('post', '/user/address', { ...addrForm, name: addrForm.name.trim(), detail: addrForm.detail.trim() });
        if (d.code === 0) { ElMessage.success('地址已保存'); addrVisible.value = false; load(); }
      }
      async function delAddr(id) { await U('delete', '/user/address/' + id); load(); }
      onMounted(load);
      return { profile, addresses, addrVisible, addrForm, save, openAddr, saveAddr, delAddr, profileTip, addrPhoneTip, digitsOnly };
    },
    template: `
      <div class="container" style="max-width:640px">
        <div class="section-title"><span class="bar"></span>个人中心</div>
        <el-card>
          <el-input v-model="profile.nickname" placeholder="昵称" style="margin-bottom:12px" />
          <el-input v-model="profile.email" placeholder="邮箱" style="margin-bottom:12px" />
          <el-input v-model="profile.phone" placeholder="手机号（11 位）" style="margin-bottom:12px" @input="profile.phone = digitsOnly($event)" />
          <div v-if="profileTip" class="field-hint" :class="'is-' + profileTip.level" style="margin-top:-8px">{{ profileTip.msg }}</div>
          <el-button type="primary" @click="save">保存资料</el-button>
        </el-card>
        <div class="section-title"><span class="bar"></span>收货地址</div>
        <el-card>
          <div v-for="a in addresses" :key="a.id" style="margin-bottom:8px;display:flex;justify-content:space-between">
            <span>{{ a.name }} {{ a.phone }} — {{ a.detail }} <el-tag v-if="a.is_default" size="small">默认</el-tag></span>
            <el-button text type="danger" @click="delAddr(a.id)">删除</el-button>
          </div>
          <el-button @click="openAddr">+ 新增地址</el-button>
        </el-card>
        <el-dialog v-model="addrVisible" title="新增地址">
          <el-input v-model="addrForm.name" placeholder="收货人" style="margin-bottom:10px" />
          <el-input v-model="addrForm.phone" placeholder="手机号（11 位）" style="margin-bottom:10px" @input="addrForm.phone = digitsOnly($event)" />
          <div v-if="addrPhoneTip" class="field-hint" :class="'is-' + addrPhoneTip.level" style="margin-top:-6px">{{ addrPhoneTip.msg }}</div>
          <el-input v-model="addrForm.detail" placeholder="详细地址" style="margin-bottom:10px" />
          <el-checkbox v-model="addrForm.is_default">设为默认</el-checkbox>
          <template #footer><el-button type="primary" @click="saveAddr">保存</el-button></template>
        </el-dialog>
      </div>`
  };

  // ---------- 我的收藏 ----------
  const Favorites = {
    setup() {
      const list = ref([]);
      const loading = ref(true);
      async function load() {
        if (!requireLogin()) return;
        loading.value = true;
        const d = await U('get', '/product/favorites');
        if (d.code === 0) list.value = d.data || [];
        loading.value = false;
      }
      onMounted(load);
      return { list, loading, go, money };
    },
    template: `
      <div class="container">
        <div class="section-title"><span class="bar"></span>我的收藏</div>
        <div class="hint" style="margin-bottom:12px">你收藏过的商品会进入这里，并实时影响「猜你喜欢」的推荐结果。</div>
        <div v-if="loading" class="empty">加载中…</div>
        <el-empty v-else-if="!list.length" description="还没有收藏任何商品，去首页逛逛吧" />
        <div v-else class="grid">
          <product-card v-for="p in list" :key="'f' + p.id" :product="p" />
        </div>
      </div>`
  };

  // ---------- 公告（仅管理员可发布，所有用户/游客都能看） ----------
  const Notice = {
    setup() {
      const list = ref([]);
      const loading = ref(true);
      const isAdmin = computed(() => isAdminMode());
      const dialog = ref(false);
      const form = reactive({ title: '', content: '' });

      async function load() {
        loading.value = true;
        const d = await U('get', '/notice/list');
        if (d.code === 0) list.value = d.data || [];
        loading.value = false;
      }
      async function publish() {
        const title = String(form.title || '').trim();
        const content = String(form.content || '').trim();
        if (!title) { ElMessage.warning('请填写公告标题'); return; }
        if (!content) { ElMessage.warning('请填写公告内容'); return; }
        const d = await A('post', '/admin/notice', { title, content });
        if (d.code === 0) {
          ElMessage.success('公告已发布，所有用户都能看到');
          dialog.value = false; form.title = ''; form.content = '';
          load();
        }
      }
      const fmtTime = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '');
      onMounted(load);
      return { list, loading, isAdmin, dialog, form, publish, fmtTime, go };
    },
    template: `
      <div class="container" style="max-width:820px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
          <div class="section-title" style="margin:8px 0"><span class="bar"></span>平台公告</div>
          <el-button v-if="isAdmin" type="primary" @click="dialog=true">发布公告</el-button>
        </div>
        <div class="hint" style="color:#a86b3c;font-size:12px;margin:-4px 0 14px">
          {{ isAdmin ? '你是管理员：发布后所有用户打开「公告」都能看到。' : '公告由管理员发布，所有用户均可查看。' }}
        </div>
        <div v-if="loading" class="empty">加载中…</div>
        <el-empty v-else-if="!list.length" description="暂无公告" />
        <el-card v-for="n in list" :key="n.id" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
            <div style="font-weight:600;color:#7c2d12;font-size:15px">{{ n.title }}</div>
            <div style="font-size:12px;color:#b08968;white-space:nowrap">{{ fmtTime(n.created_at) }}</div>
          </div>
          <div style="line-height:1.75;color:#606266;margin-top:8px;white-space:pre-wrap">{{ n.content }}</div>
        </el-card>

        <el-dialog v-model="dialog" title="发布公告" width="520px">
          <el-input v-model="form.title" placeholder="公告标题（如：国庆假期交易须知）" style="margin-bottom:10px" />
          <el-input v-model="form.content" type="textarea" :rows="5" placeholder="公告内容" />
          <template #footer>
            <el-button @click="dialog=false">取消</el-button>
            <el-button type="primary" @click="publish">发布</el-button>
          </template>
        </el-dialog>
      </div>`
  };

  // ---------- 后台管理 ----------
  const Admin = {
    setup() {
      const logged = computed(() => !!store.adminToken);
      const isNormalUser = computed(() => !!store.token && !store.adminToken);
      const form = reactive({ username: '', password: '' });
      const stats = reactive({ users: 0, products: 0, orders: 0, revenue: 0, messages: 0 });
      const users = ref([]);
      const products = ref([]);
      const interactions = ref([]);
      const adminName = computed(() => store.adminName || 'admin');
      // 下拉切换管理模块：用户管理（默认，与数据看板同屏）/ 商品管理 / 推荐算法行为数据
      const charts = ref(null);
      const module = ref('users');
      const cf = ref(null);
      const cfLoading = ref(false);
      async function loadCF() {
        cfLoading.value = true;
        const d = await A('get', '/admin/cf-insight');
        if (d.code === 0) cf.value = d.data;
        cfLoading.value = false;
      }
      watch(module, (m) => { if (m === 'algo' && !cf.value) loadCF(); });

      async function adminLogin() {
        const aname = noSpace(form.username);
        form.username = aname;
        if (!aname) { ElMessage.warning('请输入管理员账号（不能只输入空格）'); return; }
        if (!form.password) { ElMessage.warning('请输入管理员密码'); return; }
        const d = await A('post', '/auth/admin/login', { username: aname, password: form.password });
        if (d.code === 0) {
          // 管理员是独立账号：登录后清掉普通用户身份，界面整体切换为「管理员模式」
          store.token = ''; localStorage.removeItem('token'); store.user = null;
          store.adminToken = d.data.token || 'admin';
          store.adminName = (d.data.admin && d.data.admin.username) || aname;
          localStorage.setItem('adminToken', store.adminToken);
          localStorage.setItem('adminName', store.adminName);
          form.password = '';
          ElMessage.success('管理员登录成功');
          go('admin');
          loadAll();
        }
      }
      function logout() { adminLogout(); }
      function switchToAdmin() { store.token = ''; localStorage.removeItem('token'); store.user = null; }
      async function loadAll() {
        const s = await A('get', '/admin/stats'); if (s.code === 0) Object.assign(stats, s.data);
        const u = await A('get', '/admin/users'); if (u.code === 0) users.value = u.data;
        const p = await A('get', '/admin/products'); if (p.code === 0) products.value = p.data;
        const it = await A('get', '/admin/interactions'); if (it.code === 0) interactions.value = it.data;
        const ch = await A('get', '/admin/charts'); if (ch.code === 0) charts.value = ch.data;
      }
      async function toggleProduct(p) {
        await A('put', '/admin/product/' + p.id + '/status', { status: p.status === 1 ? 0 : 1 });
        loadAll();
      }
      onMounted(() => { if (logged.value) loadAll(); });
      return { logged, isNormalUser, adminName, form, adminLogin, logout, switchToAdmin, stats, users, products, interactions, toggleProduct, go, module, cf, cfLoading, charts, money };
    },
    template: `
      <div class="container">
        <div v-if="!logged" class="login-wrap">
          <template v-if="isNormalUser">
            <el-result icon="warning" title="无权限" sub-title="当前登录的是普通用户账号，无法进入后台管理。">
              <template #extra>
                <el-button type="primary" @click="switchToAdmin">以管理员身份登录</el-button>
              </template>
            </el-result>
          </template>
          <template v-else>
            <h2 style="text-align:center;color:#ea580c;margin-top:0">后台管理</h2>
            <div class="hint" style="text-align:center;color:#a86b3c;font-size:12px;margin:-6px 0 14px">管理员是独立账号，登录后界面只保留 首页 / 公告 / 后台</div>
            <el-input v-model="form.username" placeholder="管理员账号（不支持空格）" style="margin-bottom:12px" @input="form.username = noSpace($event)" />
            <el-input v-model="form.password" type="password" placeholder="密码" show-password style="margin-bottom:12px" @keyup.enter="adminLogin" />
            <el-button type="primary" style="width:100%" @click="adminLogin">登录后台</el-button>
          </template>
        </div>
        <template v-else>
          <div class="admin-hello">管理员身份：{{ adminName }}（独立账号，与普通用户完全分开）</div>

          <!-- 数据看板：始终在最上方，与「用户管理」同屏 -->
          <div class="section-title" style="margin:12px 0 10px"><span class="bar"></span>数据看板</div>
          <div class="row">
            <el-card v-for="(v,k) in {用户:stats.users,商品:stats.products,订单:stats.orders,消息:stats.messages}" :key="k" class="stat-card">
              <div class="stat-num">{{ v }}</div><div class="stat-lab">{{ k }}</div>
            </el-card>
            <el-card class="stat-card"><div class="stat-num" style="color:#f56c6c">{{ '¥'+(Number(stats.revenue)||0).toFixed(2) }}</div><div class="stat-lab">成交额</div></el-card>
          </div>

          <div class="row chart-row" v-if="charts">
            <el-card class="chart-card">
              <div class="chart-title">各类目成交额（元）</div>
              <mini-chart v-if="charts.byCategory && charts.byCategory.length" type="bar"
                          :labels="charts.byCategory.map(x=>x.name)" :values="charts.byCategory.map(x=>x.amount)" />
              <div v-else class="empty" style="padding:24px 0;font-size:13px">暂无成交数据，去下单后这里就会有图</div>
            </el-card>
            <el-card class="chart-card">
              <div class="chart-title">近 7 日成交额走势（元）</div>
              <mini-chart v-if="charts.byDay && charts.byDay.length" type="line"
                          :labels="charts.byDay.map(x=>x.day)" :values="charts.byDay.map(x=>x.amount)" />
            </el-card>
          </div>

          <!-- 管理模块下拉：用户管理 / 商品管理 / 推荐算法行为数据 -->
          <div class="admin-toolbar">
            <span class="at-label">管理模块</span>
            <el-select v-model="module" style="width:230px">
              <el-option label="用户管理" value="users" />
              <el-option label="商品管理" value="products" />
              <el-option label="推荐算法行为数据" value="algo" />
            </el-select>
            <span class="at-hint">{{ module==='users' ? '与上方数据看板同屏查看' : (module==='products' ? '点击按钮切换上下架' : '协同过滤的相似度与推荐依据') }}</span>
            <div class="spacer"></div>
            <el-button @click="go('notice')">发布公告</el-button>
            <el-button text type="danger" @click="logout">退出登录</el-button>
          </div>

          <!-- ① 用户管理 -->
          <template v-if="module==='users'">
            <el-table :data="users" border size="small" height="420">
              <el-table-column prop="id" label="ID" width="70" />
              <el-table-column prop="username" label="账号" />
              <el-table-column prop="nickname" label="昵称" />
              <el-table-column prop="email" label="邮箱" />
              <el-table-column prop="role" label="角色" width="80" />
            </el-table>
          </template>

          <!-- ② 商品管理 -->
          <template v-else-if="module==='products'">
            <el-table :data="products" border size="small" height="420">
              <el-table-column prop="id" label="ID" width="70" />
              <el-table-column prop="title" label="标题" />
              <el-table-column prop="seller" label="卖家" width="120" />
              <el-table-column prop="price" label="价格" width="100" />
              <el-table-column label="状态" width="110">
                <template #default="{row}"><el-tag :type="row.status===1?'success':'info'">{{ row.status===1?'在售':'已下架' }}</el-tag></template>
              </el-table-column>
              <el-table-column label="操作" width="100"><template #default="{row}"><el-button size="small" @click="toggleProduct(row)">{{ row.status===1?'下架':'上架' }}</el-button></template></el-table-column>
            </el-table>
          </template>

          <!-- ③ 推荐算法行为数据（协同过滤怎么算的，摊开看） -->
          <template v-else>
            <div v-if="cfLoading" class="empty">正在根据行为数据计算商品相似度…</div>
            <template v-else-if="cf">
              <div class="cf-note">
                算法：基于物品的协同过滤（Item-based CF）。把这些行为流水整理成「商品 × 用户」评分矩阵（浏览 1 / 加购 2 / 收藏 3 / 购买 4 分），
                两件商品被同一批人反复交互 → 余弦相似度高；推荐时把用户已交互商品与其它商品的相似度求和，取分数最高的 N 件，
                所以每条推荐都能说清「因为你看过 / 买过 X」。
              </div>
              <div class="row cf-chips">
                <el-card class="cf-chip"><div class="cf-num">{{ cf.interactions }}</div><div class="cf-lab">行为数据（条）</div></el-card>
                <el-card class="cf-chip"><div class="cf-num">{{ cf.users }}</div><div class="cf-lab">参与用户（人）</div></el-card>
                <el-card class="cf-chip"><div class="cf-num">{{ cf.items }}</div><div class="cf-lab">参与商品（件）</div></el-card>
                <el-card class="cf-chip"><div class="cf-num">{{ cf.pairs }}</div><div class="cf-lab">可比商品对（组）</div></el-card>
              </div>

              <div class="cf-sub-title">① 相似度最高的商品对（它们为什么会被排在一起）</div>
              <el-table :data="cf.topPairs" border size="small">
                <el-table-column prop="a" label="商品 A" />
                <el-table-column prop="b" label="商品 B" />
                <el-table-column prop="sim" label="余弦相似度" width="120" />
                <el-table-column prop="coUsers" label="共同交互用户数" width="140" />
              </el-table>

              <div class="cf-sub-title">② 举例：给「{{ cf.sample.nickname }}」算了什么，依据是什么</div>
              <div class="row" style="align-items:flex-start">
                <div style="flex:1;min-width:300px">
                  <div class="cf-lab2">TA 的历史行为（喂进算法的 {{ cf.sample.history.length }} 条）</div>
                  <el-table :data="cf.sample.history" border size="small" height="280">
                    <el-table-column prop="title" label="商品" />
                    <el-table-column prop="type" label="行为" width="80" />
                    <el-table-column prop="score" label="权重" width="70" />
                  </el-table>
                </div>
                <div style="flex:1.3;min-width:360px">
                  <div class="cf-lab2">算出来的推荐结果（按推荐分排序）</div>
                  <el-table :data="cf.sample.reco" border size="small" height="280">
                    <el-table-column type="index" label="#" width="50" />
                    <el-table-column prop="title" label="推荐商品" />
                    <el-table-column prop="score" label="推荐分" width="90" />
                    <el-table-column label="推荐依据（已交互商品 · 相似度）" min-width="230">
                      <template #default="{row}">
                        <div v-for="(r,i) in row.reasons" :key="i" class="cf-reason">{{ r.title }} · 相似度 {{ r.sim }}<span v-if="r.times>1">（{{ r.times }} 条行为）</span></div>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </div>
            </template>
            <div v-else class="empty">暂无算法数据</div>

            <div class="cf-sub-title">③ 原始行为流水（最新 300 条，算法的输入）</div>
            <el-table :data="interactions" border size="small" height="300">
              <el-table-column prop="nickname" label="用户" width="120" />
              <el-table-column prop="title" label="商品" />
              <el-table-column prop="type" label="行为" width="100" />
              <el-table-column prop="score" label="权重" width="80" />
            </el-table>
          </template>
        </template>
      </div>`
  };

  // ---------- 极简图表（自绘 SVG，不引入任何图表库，离线可用） ----------
  const MiniChart = {
    props: {
      type: { type: String, default: 'bar' },
      labels: { type: Array, default: () => [] },
      values: { type: Array, default: () => [] }
    },
    setup(props) {
      const W = 320, H = 150, PAD = { l: 42, r: 26, t: 18, b: 24 };
      const max = computed(() => Math.max(1, ...props.values.map((v) => Number(v) || 0)));
      const pts = computed(() => {
        const n = props.values.length || 1;
        const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
        return props.values.map((v, i) => ({
          x: PAD.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1)),
          y: PAD.t + ih - ((Number(v) || 0) / max.value) * ih,
          v: Number(v) || 0,
          label: props.labels[i] || ''
        }));
      });
      const barW = computed(() => Math.max(8, Math.min(34, (W - PAD.l - PAD.r) / (props.values.length || 1) - 10)));
      const linePath = computed(() => pts.value.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' '));
      const areaPath = computed(() => {
        if (!pts.value.length) return '';
        const y0 = H - PAD.b;
        return 'M' + pts.value[0].x.toFixed(1) + ' ' + y0 + ' ' +
          pts.value.map((p) => 'L' + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ') +
          ' L' + pts.value[pts.value.length - 1].x.toFixed(1) + ' ' + y0 + ' Z';
      });
      const gridY = computed(() => [0, 0.5, 1].map((r) => PAD.t + (H - PAD.t - PAD.b) * r));
      const fmt = (v) => {
        const n = Number(v) || 0;
        if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return String(Math.round(n * 100) / 100);
      };
      // 柱状图横轴：类别多于 5 个时只显示前 2 个字，避免标签重叠（完整名称有 hover 提示）
      const barLabel = (l) => (props.values.length > 5 && String(l).length > 2 ? String(l).slice(0, 2) : l);
      return { W, H, PAD, pts, barW, linePath, areaPath, gridY, max, fmt, barLabel };
    },
    template: `
      <svg class="mini-chart" viewBox="0 0 320 150" style="width:100%;display:block">
        <line v-for="(y,i) in gridY" :key="'g'+i" :x1="PAD.l" :y1="y" :x2="W-PAD.r" :y2="y" class="mc-grid" />
        <text v-for="(y,i) in gridY" :key="'t'+i" :x="2" :y="y+4" class="mc-axis">{{ fmt(max * (1 - i/2)) }}</text>
        <template v-if="type==='bar'">
          <g v-for="(p,i) in pts" :key="'b'+i">
            <rect :x="p.x - barW/2" :y="p.y" :width="barW" :height="H-PAD.b-p.y" rx="3" class="mc-bar" />
            <text :x="p.x" :y="p.y-4" class="mc-value">{{ fmt(p.v) }}</text>
            <text :x="p.x" :y="H-8" class="mc-label">{{ barLabel(p.label) }}<title>{{ p.label }}</title></text>
          </g>
        </template>
        <template v-else>
          <path :d="areaPath" class="mc-area" />
          <path :d="linePath" class="mc-line" />
          <circle v-for="(p,i) in pts" :key="'p'+i" :cx="p.x" :cy="p.y" r="3" class="mc-dot" />
          <text v-for="(p,i) in pts" :key="'l'+i" :x="p.x" :y="H-8" class="mc-label">{{ p.label }}</text>
        </template>
      </svg>`
  };

  // ---------- 梵高《星空》粒子背景（仅管理员模式启用） ----------
  // canvas 画一片缓慢旋转的星云：深蓝夜空 + 若干漩涡 + 发光粒子拖尾。
  // 固定在最底层且 pointer-events:none，完全不影响交互。
  const StarryBg = {
    setup() {
      const cv = ref(null);
      let ctx = null, raf = 0, W = 0, H = 0, parts = [], swirls = [], orbs = [];

      function makeSwirls() {
        const n = W < 700 ? 4 : 6;
        swirls = [];
        for (let i = 0; i < n; i++) {
          swirls.push({
            x: (i + 0.5) * (W / n) + (Math.random() - 0.5) * 60,
            y: H * (0.16 + 0.66 * ((i * 7) % 5) / 5),
            r: Math.min(W, H) * (0.10 + 0.06 * Math.random()),
            s: i % 2 ? 1 : -1
          });
        }
      }
      // 光团：一颗颗发光星体（亮点核心 + 柔和光晕），缓慢漂移与呼吸
      function makeOrbs() {
        const tints = ['#fff6d8', '#dbeafe', '#fde68a', '#c7d2fe', '#bae6fd', '#fef3c7'];
        orbs = [];
        const n = W < 700 ? 9 : 13;
        for (let i = 0; i < n; i++) {
          const big = i % 5 === 0;   // 每 5 颗里配一颗大光团
          orbs.push({
            c: tints[i % tints.length],
            x: W * (0.05 + 0.9 * ((i * 7) % n) / n),
            y: H * (0.07 + 0.86 * ((i * 5) % 11) / 11),
            r: big ? Math.max(34, Math.min(W, H) * 0.045) : Math.max(16, Math.min(W, H) * 0.018),
            a: big ? 0.026 : 0.017,   // 每帧透明度：画布拖尾会累积约 13 倍
            ph: i * 1.7,
            sp: 0.0004 + 0.0005 * (i % 4)
          });
        }
      }
      function makeParts() {
        const total = Math.max(80, Math.min(220, Math.round(W / 6)));
        const colors = ['#dbeafe', '#bfdbfe', '#fde68a', '#ffffff', '#93c5fd'];
        parts = [];
        for (let i = 0; i < total; i++) {
          const v = swirls[i % swirls.length];
          parts.push({
            v, c: colors[i % colors.length],
            a: Math.random() * Math.PI * 2,
            d: 10 + Math.random() * v.r * 1.5,
            sp: v.s * (0.0022 + Math.random() * 0.0035),
            wob: Math.random() * Math.PI * 2,
            r: 0.5 + Math.random() * 1.7,
            o: 0.22 + Math.random() * 0.55,
            x: 0, y: 0
          });
        }
      }
      function resize() {
        const c = cv.value; if (!c) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
        W = c.clientWidth || window.innerWidth;
        H = c.clientHeight || window.innerHeight;
        c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
        ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0a1330';
        ctx.fillRect(0, 0, W, H);
        makeSwirls(); makeOrbs(); makeParts();
      }
      function frame() {
        // 半透明覆盖一层 = 拖尾，模拟油画笔触的流动感
        ctx.fillStyle = 'rgba(10,19,48,0.07)';
        ctx.fillRect(0, 0, W, H);
        // 光团：核心亮点 + 两层柔和光晕（每帧叠加的透明度压得很低，靠拖尾累积成光感）
        for (let i = 0; i < orbs.length; i++) {
          const o = orbs[i];
          const t = performance.now() * o.sp + o.ph;
          const ox = o.x + Math.cos(t) * 26;
          const oy = o.y + Math.sin(t * 0.85) * 18;
          const rr = o.r * (0.9 + 0.18 * Math.sin(t * 1.2));
          const a = o.a * (0.72 + 0.28 * Math.sin(t * 1.6));
          const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr * 3.2);
          g.addColorStop(0, o.c);
          g.addColorStop(0.16, o.c);
          g.addColorStop(0.55, 'rgba(160,190,255,0.35)');
          g.addColorStop(1, 'rgba(10,19,48,0)');
          ctx.globalAlpha = a;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(ox, oy, rr * 3.2, 0, 6.2832);
          ctx.fill();
          // 核心高光：让它看起来是「一团光」而不是一片雾
          ctx.globalAlpha = Math.min(1, a * 1.35);
          ctx.fillStyle = '#fffdf3';
          ctx.beginPath();
          ctx.arc(ox, oy, rr * 0.36, 0, 6.2832);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          p.a += p.sp;
          p.wob += 0.01;
          const d = p.d + Math.sin(p.wob) * 6;
          p.x = p.v.x + Math.cos(p.a) * d;
          p.y = p.v.y + Math.sin(p.a) * d * 0.7;
          ctx.globalAlpha = p.o;
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, 6.2832);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        raf = requestAnimationFrame(frame);
      }
      function onResize() { resize(); }
      onMounted(() => {
        resize();
        frame();   // 先同步画一帧，避免开场是纯黑；frame 内部会自我调度 rAF 继续动画
        window.addEventListener('resize', onResize);
      });
      onBeforeUnmount(() => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
      });
      return { cv };
    },
    template: `<canvas ref="cv" class="starry-bg" aria-hidden="true"></canvas>`
  };

  // ---------- 根组件 ----------
  const views = { home: Home, product: ProductDetail, cart: Cart, orders: Orders, sold: SoldOrders, publish: Publish, messages: Messages, profile: Profile, favorites: Favorites, login: Login, notice: Notice, admin: Admin };
  const App = {
    setup() {
      const current = computed(() => views[route.name] || Home);
      const isAdmin = computed(() => isAdminMode());
      async function restore() {
        if (store.token) { const d = await U('get', '/user/profile'); if (d.code === 0) store.user = d.data; }
      }
      // 管理员模式下只有 首页 / 公告 / 后台，误点用户页面（购物车、订单…）自动拉回首页
      watch(() => route.name, (n) => { if (isAdmin.value && ADMIN_VIEWS.indexOf(n) === -1) go('home'); });
      onMounted(restore);
      return { route, current, store, go, isLogin, isAdmin, adminLogout, doSearch };
    },
    template: `
      <div :class="{ 'admin-mode': isAdmin }">
        <starry-bg v-if="isAdmin" />
        <header class="topbar" :class="{ 'topbar-admin': isAdmin }">
          <div class="topbar-inner">
            <div class="logo" @click="go('home')">校园二手优选 <small>{{ isAdmin ? '管理后台' : '协同过滤推荐' }}</small></div>
            <!-- 管理员：独立身份，导航只剩 首页 / 公告 / 后台 -->
            <nav class="nav" v-if="isAdmin">
              <a :class="{active: route.name==='home'}" @click="go('home')">首页</a>
              <a :class="{active: route.name==='notice'}" @click="go('notice')">公告</a>
              <a :class="{active: route.name==='admin'}" @click="go('admin')">后台</a>
            </nav>
            <nav class="nav" v-else>
              <a :class="{active: route.name==='home'}" @click="go('home')">首页</a>
              <a :class="{active: route.name==='publish'}" @click="go('publish')">发布</a>
              <a :class="{active: route.name==='cart'}" @click="go('cart')">购物车</a>
              <a :class="{active: route.name==='orders'}" @click="go('orders')">订单</a>
              <a :class="{active: route.name==='sold'}" @click="go('sold')">我卖出的</a>
              <a :class="{active: route.name==='messages'}" @click="go('messages')">私信</a>
              <a :class="{active: route.name==='notice'}" @click="go('notice')">公告</a>
              <a :class="{active: route.name==='favorites'}" @click="go('favorites')">收藏</a>
              <a :class="{active: route.name==='profile'}" @click="go('profile')">我的</a>
            </nav>
            <div class="spacer"></div>
            <template v-if="isAdmin">
              <el-tag type="primary" effect="dark">管理员 {{ store.adminName || 'admin' }}</el-tag>
              <el-button text style="color:#ffd9b3" @click="adminLogout">退出登录</el-button>
            </template>
            <template v-else>
              <el-input v-model="store.searchInput" class="search-box" placeholder="搜索商品" @keyup.enter="doSearch()" />
              <el-button type="primary" @click="doSearch()">搜索</el-button>
              <template v-if="isLogin()">
                <el-tag>{{ store.user ? store.user.nickname : '已登录' }}</el-tag>
                <el-button text @click="()=>{store.token='';localStorage.removeItem('token');store.user=null;go('home')}">退出</el-button>
              </template>
              <el-button v-else type="primary" @click="go('login')">登录 / 注册</el-button>
            </template>
          </div>
        </header>
        <main>
          <transition name="view" mode="out-in">
            <component :is="current" />
          </transition>
        </main>
        <footer class="footer">校园二手优选 · 基于协同过滤算法的校园电商推荐网站（毕业设计演示）</footer>
      </div>`
  };

  const app = createApp(App);
  app.component('product-card', ProductCard);
  app.component('starry-bg', StarryBg);
  app.component('mini-chart', MiniChart);
  if (window.ElementPlusLocaleZhCn) app.use(ElementPlus, { locale: ElementPlusLocaleZhCn });
  else app.use(ElementPlus);
  app.mount('#app');
})();
