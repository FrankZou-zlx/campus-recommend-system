import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'Home', component: () => import('../views/Home.vue') },
  { path: '/login', name: 'Login', component: () => import('../views/Login.vue') },
  { path: '/product/:id', name: 'ProductDetail', component: () => import('../views/ProductDetail.vue') },
  { path: '/publish', name: 'Publish', component: () => import('../views/Publish.vue'), meta: { auth: true } },
  { path: '/cart', name: 'Cart', component: () => import('../views/Cart.vue'), meta: { auth: true } },
  { path: '/order', name: 'Order', component: () => import('../views/Order.vue'), meta: { auth: true } },
  { path: '/message', name: 'Message', component: () => import('../views/Message.vue'), meta: { auth: true } },
  { path: '/profile', name: 'Profile', component: () => import('../views/Profile.vue'), meta: { auth: true } },
  { path: '/admin', name: 'Admin', component: () => import('../views/Admin.vue'), meta: { admin: true } }
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (to.meta.auth && !token) return next('/login');
  if (to.meta.admin && (!token || !user || user.role !== 'admin')) return next('/');
  next();
});

export default router;
