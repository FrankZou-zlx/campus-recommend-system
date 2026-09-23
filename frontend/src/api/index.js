import axios from 'axios';

const http = axios.create({ baseURL: '/api', timeout: 10000 });

http.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});

http.interceptors.response.use(
  res => {
    const data = res.data;
    if (data.code === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (location.pathname !== '/login') location.href = '/login';
    }
    return data;
  },
  err => {
    return Promise.reject(err);
  }
);

export default http;
