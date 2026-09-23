<template>
  <el-card>
    <template #header><b>发布闲置商品</b></template>
    <el-form :model="form" label-width="80px" style="max-width:560px">
      <el-form-item label="标题"><el-input v-model="form.title" placeholder="例如：九成新机械键盘" /></el-form-item>
      <el-form-item label="分类">
        <el-select v-model="form.category_id" placeholder="选择分类">
          <el-option v-for="c in cats" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="价格"><el-input-number v-model="form.price" :min="0" :precision="2" :step="1" /></el-form-item>
      <el-form-item label="库存"><el-input-number v-model="form.stock" :min="1" :step="1" /></el-form-item>
      <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="3" /></el-form-item>
      <el-form-item label="封面">
        <el-upload :auto-upload="false" :show-file-list="false" :on-change="onFile">
          <el-button>选择图片</el-button>
          <span v-if="fileName" style="margin-left:10px">{{ fileName }}</span>
        </el-upload>
      </el-form-item>
      <el-button type="primary" @click="submit">发布</el-button>
    </el-form>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import http from '../api';

const router = useRouter();
const cats = ref([]);
const fileName = ref('');
let fileObj = null;
const form = ref({ title: '', category_id: '', price: 0, stock: 1, description: '' });

function onFile(file) { fileObj = file.raw; fileName.value = file.name; }
async function submit() {
  if (!form.value.title || !form.value.price) return ElMessage.warning('标题和价格必填');
  const fd = new FormData();
  fd.append('title', form.value.title);
  fd.append('category_id', form.value.category_id);
  fd.append('price', form.value.price);
  fd.append('stock', form.value.stock);
  fd.append('description', form.value.description);
  if (fileObj) fd.append('cover', fileObj);
  const res = await http.post('/product/publish', fd);
  if (res.code === 0) { ElMessage.success('发布成功'); router.push('/'); }
  else ElMessage.error(res.msg);
}
onMounted(async () => { const r = await http.get('/category/list'); cats.value = r.data || []; });
</script>
