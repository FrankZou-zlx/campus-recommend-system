-- ============================================================
--  自动生成，请勿手改：源文件是 backend/sql/schema.sql
--  重新生成：node deploy/scripts/gen-init-sql.js
--  作用：MySQL 容器首次启动（数据卷为空）时自动建库建表
--  演示数据（120 用户 + 商品 + 行为）由 backend/sql/seed.js 灌入
-- ============================================================
CREATE DATABASE IF NOT EXISTS `campus_mall`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `campus_mall`;

-- 校园电商推荐网站 - 数据库建表 SQL
-- 数据库：campus_mall  (MySQL 8.0, utf8mb4)
-- 说明：本文件仅含数据结构(DDL)，演示数据由 backend/sql/seed.js 灌入

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. 用户表
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`    VARCHAR(50)  NOT NULL COMMENT '登录账号',
  `password`    VARCHAR(100) NOT NULL COMMENT 'bcrypt 哈希',
  `nickname`    VARCHAR(50)  DEFAULT '' COMMENT '昵称',
  `avatar`      VARCHAR(255) DEFAULT '' COMMENT '头像URL',
  `email`       VARCHAR(100) DEFAULT '',
  `phone`       VARCHAR(20)  DEFAULT '',
  `role`        TINYINT      NOT NULL DEFAULT 0 COMMENT '0=普通用户 1=卖家',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户';

-- 2. 后台管理员表
DROP TABLE IF EXISTS `admin`;
CREATE TABLE `admin` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`    VARCHAR(50)  NOT NULL,
  `password`    VARCHAR(100) NOT NULL COMMENT 'bcrypt 哈希',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='后台管理员';

-- 3. 商品分类表
DROP TABLE IF EXISTS `category`;
CREATE TABLE `category` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(50)  NOT NULL COMMENT '分类名',
  `parent_id`   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '父分类,0=一级',
  `sort`        INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品分类';

-- 4. 商品表
DROP TABLE IF EXISTS `product`;
CREATE TABLE `product` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `seller_id`   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '发布者(user.id)',
  `category_id` INT UNSIGNED NOT NULL DEFAULT 0,
  `title`       VARCHAR(120) NOT NULL COMMENT '商品标题',
  `description` TEXT,
  `price`       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `stock`       INT UNSIGNED NOT NULL DEFAULT 1,
  `cover`       VARCHAR(255) DEFAULT '' COMMENT '封面图URL',
  `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '1=在售 0=下架',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品';

-- 5. 商品图片表
DROP TABLE IF EXISTS `product_image`;
CREATE TABLE `product_image` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`  INT UNSIGNED NOT NULL,
  `url`         VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品图片';

-- 6. 收货地址表
DROP TABLE IF EXISTS `address`;
CREATE TABLE `address` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `name`        VARCHAR(50)  NOT NULL,
  `phone`       VARCHAR(20)  NOT NULL,
  `detail`      VARCHAR(255) NOT NULL,
  `is_default`  TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收货地址';

-- 7. 购物车表
DROP TABLE IF EXISTS `cart`;
CREATE TABLE `cart` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `product_id`  INT UNSIGNED NOT NULL,
  `quantity`    INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_product` (`user_id`,`product_id`),
  KEY `idx_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='购物车';

-- 8. 订单表
DROP TABLE IF EXISTS `order`;
CREATE TABLE `order` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no`    VARCHAR(40)  NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL,
  `total`       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `status`      TINYINT      NOT NULL DEFAULT 0 COMMENT '0=待付款 1=已付款 2=已发货·待收货 3=已完成 4=已取消',
  `address_id`  INT UNSIGNED NOT NULL DEFAULT 0,
  `shipped_at`  DATETIME     DEFAULT NULL COMMENT '卖家发货时间',
  `finished_at` DATETIME     DEFAULT NULL COMMENT '买家确认收货时间',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单';

-- 9. 订单明细表
DROP TABLE IF EXISTS `order_item`;
CREATE TABLE `order_item` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`    INT UNSIGNED NOT NULL,
  `product_id`  INT UNSIGNED NOT NULL,
  `title`       VARCHAR(120) NOT NULL,
  `price`       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `quantity`    INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单明细';

-- 10. 用户行为表(供推荐算法使用)
DROP TABLE IF EXISTS `interaction`;
CREATE TABLE `interaction` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `product_id`  INT UNSIGNED NOT NULL,
  `type`        VARCHAR(20)  NOT NULL COMMENT 'view/favorite/cart/buy',
  `score`       TINYINT      NOT NULL DEFAULT 1 COMMENT '行为权重: view=1 favorite=3 cart=4 buy=5',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_product_type` (`user_id`,`product_id`,`type`),
  KEY `idx_product` (`product_id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户行为(推荐用)';

-- 11. 私信表
DROP TABLE IF EXISTS `message`;
CREATE TABLE `message` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `from_id`     INT UNSIGNED NOT NULL,
  `to_id`       INT UNSIGNED NOT NULL,
  `content`     VARCHAR(500) NOT NULL,
  `is_read`     TINYINT      NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_to` (`to_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内私信';

-- 12. 公告表
DROP TABLE IF EXISTS `notice`;
CREATE TABLE `notice` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`       VARCHAR(120) NOT NULL,
  `content`     TEXT,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='公告';

-- 13. 搜索日志表（搜索历史 / 热搜词）
DROP TABLE IF EXISTS `search_log`;
CREATE TABLE `search_log` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL DEFAULT 0,
  `keyword`     VARCHAR(60)  NOT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`),
  KEY `idx_kw` (`keyword`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='搜索日志';

SET FOREIGN_KEY_CHECKS = 1;
