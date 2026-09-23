<template>
  <el-card>
    <template #header><b>站内私信</b></template>
    <div class="msg-layout">
      <div class="contacts">
        <div v-for="c in contacts" :key="c.id" class="contact" :class="{active: activeId===c.peer}" @click="openTalk(c)">
          <div class="c-name">{{ c.nickname }}</div>
          <div class="c-last">{{ c.last_msg }}</div>
        </div>
        <el-empty v-if="!contacts.length" description="暂无会话" :image-size="60" />
      </div>
      <div class="chat">
        <template v-if="activeId">
          <div class="bubbles">
            <div v-for="m in talk" :key="m.id" class="bubble" :class="m.from_id===uid ? 'mine' : 'other'">
              {{ m.content }}
            </div>
          </div>
          <div class="send-bar">
            <el-input v-model="text" placeholder="输入消息，回车发送" @keyup.enter="send" />
            <el-button type="primary" @click="send">发送</el-button>
          </div>
        </template>
        <el-empty v-else description="选择一个会话开始聊天" />
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import http from '../api';

const route = useRoute();
const uid = JSON.parse(localStorage.getItem('user') || '{}').id || 0;
const contacts = ref([]);
const talk = ref([]);
const activeId = ref(null);
const text = ref('');

async function loadContacts() {
  const res = await http.get('/message/contacts');
  contacts.value = res.data || [];
  if (route.query.to) {
    const to = Number(route.query.to);
    if (!contacts.value.find(c => c.peer === to)) contacts.value.unshift({ peer: to, nickname: '卖家#' + to, last_msg: '' });
    openTalk(contacts.value.find(c => c.peer === to));
  }
}
function openTalk(c) {
  activeId.value = c.peer;
  loadTalk();
}
async function loadTalk() {
  const res = await http.get('/message/talk/' + activeId.value);
  talk.value = res.data || [];
  await http.put('/message/read/' + activeId.value).catch(() => {});
}
async function send() {
  if (!text.value.trim() || !activeId.value) return;
  await http.post('/message/send', { to_id: activeId.value, content: text.value.trim() });
  text.value = '';
  loadTalk();
}
onMounted(loadContacts);
</script>

<style scoped>
.msg-layout { display: flex; gap: 16px; min-height: 420px; }
.contacts { width: 220px; border-right: 1px solid #eee; }
.contact { padding: 10px; cursor: pointer; border-radius: 8px; }
.contact:hover, .contact.active { background: #f0f5ff; }
.c-name { font-weight: 600; font-size: 14px; }
.c-last { color: #999; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat { flex: 1; display: flex; flex-direction: column; }
.bubbles { flex: 1; overflow-y: auto; padding: 10px; }
.bubble { max-width: 60%; padding: 8px 12px; border-radius: 12px; margin-bottom: 10px; word-break: break-all; }
.mine { background: #95ec69; margin-left: auto; }
.other { background: #fff; border: 1px solid #eee; }
.send-bar { display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; }
</style>
