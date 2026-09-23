"""部署套件一致性校验（临时脚本，跑完即删）
目的：确保 compose / Dockerfile / nginx / systemd / 脚本 之间的路径、端口、服务名、变量名对得上，
     避免在 Linux 上才发现"路径写错"这类低级问题。
"""
import os, re, sys, yaml

ROOT = r'D:/workbuddy.file/2026-09-03-13-40-36/campus-mall'
ok_list, bad_list = [], []

def check(name, cond, detail=''):
    (ok_list if cond else bad_list).append(f'{name}{("  -> " + detail) if detail else ""}')

def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

def exists(p):
    return os.path.exists(os.path.join(ROOT, p))

# ---------- 1. compose YAML 可解析 + 结构 ----------
compose = yaml.safe_load(read('docker-compose.yml'))
check('docker-compose.yml 可被 YAML 解析', True)
svcs = compose.get('services', {})
check('compose 含 db / api / web 三个服务', set(svcs) == {'db', 'api', 'web'}, str(list(svcs)))

# ---------- 2. build 路径与文件存在性 ----------
for s, svc in svcs.items():
    if 'build' in svc:
        df = svc['build'].get('dockerfile', '')
        check(f'{s} 的 dockerfile 存在', exists(df), df)

check('Dockerfile.backend 引用的 backend/package.json 存在', exists('backend/package.json'))
check('Dockerfile.backend 引用的 backend/package-lock.json 存在', exists('backend/package-lock.json'))
check('Dockerfile.frontend 引用的 frontend/ 存在', exists('frontend'))
check('Dockerfile.frontend 引用的 demo-dist/ 存在', exists('demo-dist'))
check('Dockerfile.frontend 引用的 nginx 配置存在', exists('deploy/docker/nginx-docker.conf'))
check('compose 挂载的 init.sql 存在', exists('deploy/mysql/init.sql'))

# ---------- 3. 端口 / 服务名 / 主机名一致性 ----------
api = svcs['api']
api_port = str(api['environment']['PORT'])
nginx_conf = read('deploy/docker/nginx-docker.conf')
check('容器内 nginx 反代目标 = api 服务名 + 后端端口',
      f'http://api:{api_port}' in nginx_conf, f'期望 http://api:{api_port}')
check('compose 后端 DB_HOST 指向 db 服务名', api['environment']['DB_HOST'] == 'db')
check('nginx 站点根目录与 HTML 拷贝目标一致',
      '/usr/share/nginx/html' in nginx_conf and '/usr/share/nginx/html' in read('deploy/docker/Dockerfile.frontend'))
check('api 容器暴露端口与 Dockerfile EXPOSE 一致',
      'EXPOSE ' + api_port in read('deploy/docker/Dockerfile.backend'), 'EXPOSE ' + api_port)

# ---------- 4. .env.example 与 compose 变量引用匹配 ----------
env_example = read('.env.example')
used = set()
for m in re.finditer(r'\$\{([A-Z_]+)', read('docker-compose.yml')):
    used.add(m.group(1))
defined = set(re.findall(r'^([A-Z_]+)=', env_example, re.M))
missing = used - defined
check('.env.example 覆盖 compose 引用的全部变量', not missing, f'缺少 {sorted(missing)}')

# ---------- 5. 裸机套件：systemd / nginx / 脚本 相互一致 ----------
unit = read('deploy/systemd/campus-mall-api.service')
script = read('deploy/scripts/install-rhel.sh')
bare_nginx = read('deploy/nginx/campus-mall.conf')

check('systemd 的 WorkingDirectory 与安装脚本 APP_DIR/backend 一致',
      'WorkingDirectory=/opt/campus-mall/backend' in unit and 'APP_DIR="/opt/campus-mall"' in script)
check('systemd 的 EnvironmentFile 与脚本 CONF_DIR 一致',
      'EnvironmentFile=/etc/campus-mall/api.env' in unit and 'CONF_DIR="/etc/campus-mall"' in script)
check('systemd 运行用户 campus 与脚本创建的用户一致',
      'User=campus' in unit and 'useradd -r -s /sbin/nologin -d "$APP_DIR" campus' in script)
check('systemd ExecStart 的入口文件存在', exists('backend/src/app.js'))
check('裸机 nginx root 与脚本拷贝位置一致',
      'root   /opt/campus-mall/frontend;' in bare_nginx and '/opt/campus-mall' in script)
check('裸机 nginx 反代端口与后端默认端口一致',
      'proxy_pass         http://127.0.0.1:3001;' in bare_nginx)
check('裸机 nginx 的 /demo 目录与脚本拷贝的 demo 目录一致',
      'root  /opt/campus-mall;' in bare_nginx and 'cp -r "$SRC_DIR/demo-dist" "$APP_DIR/demo"' in script)
check('脚本把 nginx / systemd / env 都安装到位',
      all(x in script for x in ['/etc/nginx/conf.d/campus-mall.conf',
                                '/etc/systemd/system/campus-mall-api.service',
                                '"$CONF_DIR/api.env"']))
check('脚本含 SELinux 处理（httpd_can_network_connect + fcontext）',
      'setsebool -P httpd_can_network_connect 1' in script and 'semanage fcontext' in script)
check('脚本含 firewalld 放行', 'firewall-cmd --permanent --add-service=http' in script)
check('脚本灌数据用的入口与 package.json scripts 一致',
      'node sql/seed.js' in script and exists('backend/sql/seed.js'))
check('备份脚本与脚本中的 env 路径一致',
      '/etc/campus-mall/api.env' in read('deploy/scripts/backup-db.sh'))

# ---------- 6. 环境变量名与后端代码一致 ----------
backend_envs = set()
for f in ['backend/src/db.js', 'backend/src/app.js', 'backend/src/middleware/auth.js']:
    backend_envs |= set(re.findall(r'process\.env\.([A-Z_]+)', read(f)))
env_template = set(re.findall(r'^([A-Z_]+)=', read('deploy/env/api.env.example'), re.M))
check('api.env.example 覆盖后端读取的全部环境变量',
      backend_envs <= env_template, f'缺少 {sorted(backend_envs - env_template)}')

# ---------- 7. init.sql 完整性 ----------
init_sql = read('deploy/mysql/init.sql')
schema_sql = read('backend/sql/schema.sql')
n_init = init_sql.count('CREATE TABLE')
n_schema = schema_sql.count('CREATE TABLE')
check('init.sql 的表数量与 schema.sql 一致', n_init == n_schema, f'{n_init} vs {n_schema}')
check('init.sql 含 CREATE DATABASE 与 USE', 'CREATE DATABASE' in init_sql and 'USE `campus_mall`;' in init_sql)

# ---------- 输出 ----------
print(f'通过 {len(ok_list)} 项，失败 {len(bad_list)} 项\n')
for x in ok_list:
    print('  ✔ ' + x)
if bad_list:
    print()
    for x in bad_list:
        print('  ✘ ' + x)
sys.exit(1 if bad_list else 0)
