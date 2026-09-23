<template>
  <div class="card" @click="$emit('open', product.id)">
    <div class="cover">
      <img v-if="product.cover" :src="product.cover" :alt="product.title" @error="onErr" />
      <div v-else class="cover-fallback">{{ coverText }}</div>
    </div>
    <div class="body">
      <div class="title">{{ product.title }}</div>
      <div class="meta">
        <span class="price">¥{{ product.price }}</span>
        <span v-if="product.category_name" class="cat">{{ product.category_name }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
const props = defineProps({ product: { type: Object, required: true } });
defineEmits(['open']);
const erred = ref(false);
const coverText = computed(() => (props.product.title || '?').slice(0, 2));
function onErr() { erred.value = true; }
</script>

<style scoped>
.card { background: #fff; border-radius: 10px; overflow: hidden; cursor: pointer; transition: .2s; border: 1px solid #eee; }
.card:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,.1); }
.cover { height: 160px; background: #f0f0f0; }
.cover img { width: 100%; height: 100%; object-fit: cover; }
.body { padding: 10px 12px; }
.title { font-size: 14px; color: #303133; height: 40px; overflow: hidden; }
.meta { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; }
.price { color: #f56c6c; font-weight: 700; }
.cat { font-size: 12px; color: #999; background: #f4f4f5; padding: 1px 6px; border-radius: 6px; }
</style>
