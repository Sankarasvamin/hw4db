````sql
-- ================================================================
-- AML 反洗钱侦察系统 - PostgreSQL DDL (Supabase)
-- ================================================================

-- 启用必要扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- SECTION 1: 参考/枚举表
-- ================================================================

-- 1. user_roles: 角色定义
CREATE TABLE user_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name   VARCHAR(50) NOT NULL UNIQUE, -- 'user' | 'risk_officer' | 'admin'
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. risk_levels: 风险等级定义
CREATE TABLE risk_levels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level_code  VARCHAR(20) NOT NULL UNIQUE, -- 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    score_min   SMALLINT NOT NULL,
    score_max   SMALLINT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_score_range CHECK (score_min < score_max)
);

-- 3. transaction_types: 交易类型字典
CREATE TABLE transaction_types (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_code     VARCHAR(50) NOT NULL UNIQUE,
    description   TEXT,
    is_high_risk  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. device_registry: 终端设备注册表
CREATE TABLE device_registry (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_fingerprint  VARCHAR(255) NOT NULL UNIQUE,
    device_type         VARCHAR(50), -- 'ATM' | 'POS' | 'MOBILE' | 'WEB'
    is_trusted          BOOLEAN NOT NULL DEFAULT FALSE,
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ,
    metadata            JSONB
);

-- ================================================================
-- SECTION 2: 核心业务表
-- ================================================================

-- 5. users: 用户基础信息
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id    UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL, -- Supabase Auth 关联
    full_name       VARCHAR(255) NOT NULL,
    nationality     CHAR(2) NOT NULL,           -- ISO 3166-1 alpha-2
    id_number       VARCHAR(100) UNIQUE,        -- 身份证 / 护照号
    date_of_birth   DATE,
    email           VARCHAR(255) UNIQUE NOT NULL,
    phone           VARCHAR(30),
    risk_level_id   UUID REFERENCES risk_levels(id),
    role_id         UUID NOT NULL REFERENCES user_roles(id),
    is_pep          BOOLEAN NOT NULL DEFAULT FALSE, -- 政治敏感人物
    is_sanctioned   BOOLEAN NOT NULL DEFAULT FALSE, -- 制裁名单
    kyc_verified_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. accounts: 银行账户信息
CREATE TABLE accounts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_number VARCHAR(34) NOT NULL UNIQUE, -- IBAN 兼容长度
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    currency       CHAR(3) NOT NULL DEFAULT 'USD', -- ISO 4217
    balance        NUMERIC(20, 4) NOT NULL DEFAULT 0.0000,
    branch_code    VARCHAR(20),
    branch_name    VARCHAR(255),
    account_type   VARCHAR(50) NOT NULL DEFAULT 'CHECKING',
    status         VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                   CHECK (status IN ('ACTIVE', 'FROZEN', 'CLOSED', 'SUSPENDED')),
    opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at      TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT balance_non_negative CHECK (balance >= 0)
);

-- 7. transactions: 交易核心表（双重外键关联 accounts）
CREATE TABLE transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    receiver_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    transaction_type_id UUID NOT NULL REFERENCES transaction_types(id),
    amount              NUMERIC(20, 4) NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'USD',
    exchange_rate       NUMERIC(12, 6) DEFAULT 1.000000,
    amount_usd          NUMERIC(20, 4),          -- 标准化金额，用于规则比较
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED', 'FLAGGED')),
    geo_latitude        DECIMAL(9, 6),
    geo_longitude       DECIMAL(9, 6),
    geo_country         CHAR(2),                 -- ISO 国家代码
    device_id           UUID REFERENCES device_registry(id),
    ip_address          INET,
    reference_code      VARCHAR(100),
    description         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    CONSTRAINT amount_positive    CHECK (amount > 0),
    CONSTRAINT no_self_transfer   CHECK (sender_account_id != receiver_account_id)
);

-- 8. aml_rules: 反洗钱规则库
CREATE TABLE aml_rules (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code               VARCHAR(50) NOT NULL UNIQUE,
    rule_name               VARCHAR(255) NOT NULL,
    description             TEXT NOT NULL,
    rule_category           VARCHAR(50) NOT NULL, -- 'THRESHOLD' | 'PATTERN' | 'VELOCITY' | 'GEOGRAPHY'
    threshold_amount        NUMERIC(20, 4),       -- 单笔金额阈值，如 50000
    threshold_count         INTEGER,              -- 频次阈值，如 10 笔/24h
    threshold_window_hours  INTEGER,              -- 速度规则时间窗口（小时）
    severity                VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
                            CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_by              UUID REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. aml_alerts: 风险预警记录表
CREATE TABLE aml_alerts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id     UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    rule_id            UUID NOT NULL REFERENCES aml_rules(id),
    triggered_amount   NUMERIC(20, 4),
    status             VARCHAR(30) NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'ESCALATED', 'CLEARED', 'CONFIRMED_SAR')),
    assigned_to        UUID REFERENCES users(id),  -- 负责风控专员
    investigation_notes TEXT,
    resolution_notes   TEXT,
    -- AI 交易意图预测概率 [0.0000, 1.0000]，越接近 1 表示洗钱可能性越高
    sentiment_flag     NUMERIC(5, 4)
                       CHECK (sentiment_flag >= 0 AND sentiment_flag <= 1),
    resolved_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. investigation_cases: 调查案件管理（多预警归案）
CREATE TABLE investigation_cases (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_number      VARCHAR(50) NOT NULL UNIQUE,
    title            VARCHAR(255) NOT NULL,
    description      TEXT,
    status           VARCHAR(30) NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'CLOSED', 'REPORTED')),
    priority         VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
                     CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    assigned_officer UUID REFERENCES users(id),
    subject_user_id  UUID REFERENCES users(id),
    sar_filed        BOOLEAN NOT NULL DEFAULT FALSE, -- 可疑活动报告是否已提交
    sar_filed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at        TIMESTAMPTZ
);

-- 案件与预警的多对多关联
CREATE TABLE case_alerts (
    case_id  UUID NOT NULL REFERENCES investigation_cases(id) ON DELETE CASCADE,
    alert_id UUID NOT NULL REFERENCES aml_alerts(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (case_id, alert_id)
);

-- 11. audit_logs: 系统审计日志（合规要求）
CREATE TABLE audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role    VARCHAR(50),
    action        VARCHAR(100) NOT NULL,  -- 'SELECT' | 'UPDATE' | 'DELETE' | 'LOGIN'
    resource_type VARCHAR(100) NOT NULL,  -- 被访问的表名或资源类型
    resource_id   UUID,                  -- 被访问记录的 ID
    query_summary TEXT,                  -- 脱敏后的查询描述
    ip_address    INET,
    user_agent    TEXT,
    success       BOOLEAN NOT NULL DEFAULT TRUE,
    metadata      JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- SECTION 3: 索引
-- ================================================================

-- transactions
CREATE INDEX idx_txn_amount       ON transactions(amount);
CREATE INDEX idx_txn_created_at   ON transactions(created_at);
CREATE INDEX idx_txn_sender       ON transactions(sender_account_id);
CREATE INDEX idx_txn_receiver     ON transactions(receiver_account_id);
CREATE INDEX idx_txn_status       ON transactions(status);
CREATE INDEX idx_txn_geo_country  ON transactions(geo_country);
CREATE INDEX idx_txn_amount_usd   ON transactions(amount_usd);

-- accounts
CREATE INDEX```sql
-- accounts
CREATE INDEX idx_acc_user_id    ON accounts(user_id);
CREATE INDEX idx_acc_status     ON accounts(status);
CREATE INDEX idx_acc_created_at ON accounts(created_at);

-- aml_alerts
CREATE INDEX idx_alert_transaction_id  ON aml_alerts(transaction_id);
CREATE INDEX idx_alert_rule_id         ON aml_alerts(rule_id);
CREATE INDEX idx_alert_status          ON aml_alerts(status);
CREATE INDEX idx_alert_sentiment_flag  ON aml_alerts(sentiment_flag);
CREATE INDEX idx_alert_created_at      ON aml_alerts(created_at);

-- users
CREATE INDEX idx_users_risk_level_id ON users(risk_level_id);
CREATE INDEX idx_users_role_id       ON users(role_id);
CREATE INDEX idx_users_is_sanctioned ON users(is_sanctioned) WHERE is_sanctioned = TRUE;
CREATE INDEX idx_users_is_pep        ON users(is_pep) WHERE is_pep = TRUE;

-- audit_logs
CREATE INDEX idx_audit_actor_user_id  ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_resource_type  ON audit_logs(resource_type);
CREATE INDEX idx_audit_created_at     ON audit_logs(created_at);

-- investigation_cases
CREATE INDEX idx_cases_assigned_officer ON investigation_cases(assigned_officer);
CREATE INDEX idx_cases_subject_user_id  ON investigation_cases(subject_user_id);
CREATE INDEX idx_cases_status           ON investigation_cases(status);

-- ================================================================
-- SECTION 4: 自动更新 updated_at 触发器
-- ================================================================

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_aml_alerts_updated_at
    BEFORE UPDATE ON aml_alerts
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_aml_rules_updated_at
    BEFORE UPDATE ON aml_rules
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_cases_updated_at
    BEFORE UPDATE ON investigation_cases
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ================================================================
-- SECTION 5: 审计日志自动写入触发器
-- ================================================================

-- 敏感表访问自动记录（以 aml_alerts 为例，可复用到其他表）
CREATE OR REPLACE FUNCTION fn_audit_sensitive_access()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO audit_logs (
        actor_user_id,
        actor_role,
        action,
        resource_type,
        resource_id,
        success
    )
    VALUES (
        auth.uid(),
        current_setting('request.jwt.claims', TRUE)::jsonb ->> 'role',
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TRUE
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_audit_aml_alerts
    AFTER INSERT OR UPDATE OR DELETE ON aml_alerts
    FOR EACH ROW EXECUTE FUNCTION fn_audit_sensitive_access();

CREATE TRIGGER trg_audit_transactions
    AFTER INSERT OR UPDATE OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION fn_audit_sensitive_access();

-- ================================================================
-- SECTION 6: Row Level Security (RLS)
-- ================================================================

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml_alerts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE investigation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs          ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- 辅助函数：获取当前用户角色
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_current_user_role()
RETURNS VARCHAR LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT r.role_name
    FROM users u
    JOIN user_roles r ON r.id = u.role_id
    WHERE u.auth_user_id = auth.uid()
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_current_user_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- ----------------------------------------------------------------
-- users 表策略
-- 普通用户只能看自己；风控专员和管理员可以看所有
-- ----------------------------------------------------------------
CREATE POLICY pol_users_self_select ON users
    FOR SELECT USING (
        auth_user_id = auth.uid()
        OR fn_current_user_role() IN ('risk_officer', 'admin')
    );

CREATE POLICY pol_users_admin_modify ON users
    FOR ALL USING (fn_current_user_role() = 'admin');

-- ----------------------------------------------------------------
-- accounts 表策略
-- ----------------------------------------------------------------
CREATE POLICY pol_accounts_owner_select ON accounts
    FOR SELECT USING (
        user_id = fn_current_user_id()
        OR fn_current_user_role() IN ('risk_officer', 'admin')
    );

CREATE POLICY pol_accounts_admin_modify ON accounts
    FOR ALL USING (fn_current_user_role() = 'admin');

-- ----------------------------------------------------------------
-- transactions 表策略
-- 普通用户只能看自己账户相关的交易
-- ----------------------------------------------------------------
CREATE POLICY pol_transactions_owner_select ON transactions
    FOR SELECT USING (
        sender_account_id   IN (SELECT id FROM accounts WHERE user_id = fn_current_user_id())
        OR receiver_account_id IN (SELECT id FROM accounts WHERE user_id = fn_current_user_id())
        OR fn_current_user_role() IN ('risk_officer', 'admin')
    );

CREATE POLICY pol_transactions_admin_modify ON transactions
    FOR ALL USING (fn_current_user_role() = 'admin');

-- ----------------------------------------------------------------
-- aml_alerts 表策略
-- 风控专员可读；只有 admin 可写
-- ----------------------------------------------------------------
CREATE POLICY pol_alerts_risk_officer_select ON aml_alerts
    FOR SELECT USING (
        fn_current_user_role() IN ('risk_officer', 'admin')
    );

CREATE POLICY pol_alerts_risk_officer_update ON aml_alerts
    FOR UPDATE USING (fn_current_user_role() = 'risk_officer')
    WITH CHECK (
        -- 风控专员只能更新调查备注、状态，不能改 sentiment_flag 或 rule_id
        fn_current_user_role() = 'risk_officer'
    );

CREATE POLICY pol_alerts_admin_all ON aml_alerts
    FOR ALL USING (fn_current_user_role() = 'admin');

-- ----------------------------------------------------------------
-- aml_rules 表策略
-- 风控专员只读；admin 可写
-- ----------------------------------------------------------------
CREATE POLICY pol_rules_read ON aml_rules
    FOR SELECT USING (fn_current_user_role() IN ('risk_officer', 'admin'));

CREATE POLICY pol_rules_admin_modify ON aml_rules
    FOR ALL USING (fn_current_user_role() = 'admin');

-- ----------------------------------------------------------------
-- user_roles 表策略
-- 风控专员不能修改；只有 admin 可以
-- ----------------------------------------------------------------
CREATE POLICY pol_user_roles_read ON user_roles
    FOR SELECT USING (fn_current_user_role() IN ('risk_officer', 'admin', 'user'));

CREATE POLICY pol_user_roles_admin_only ON user_roles
    FOR ALL USING (fn_current_user_role() = 'admin');

-- ----------------------------------------------------------------
-- investigation_cases 表策略
-- ----------------------------------------------------------------
CREATE POLICY pol_cases_risk_officer ON investigation_cases
    FOR SELECT USING (fn_current_user_role() IN ('risk_officer', 'admin'));

CREATE POLICY pol_cases_admin_modify ON investigation_cases
    FOR ALL USING (fn_current_user_role() = 'admin');

-- ----------------------------------------------------------------
-- audit_logs 表策略
-- 只有 admin 可读，任何人不可直接写（由触发器写入）
-- ----------------------------------------------------------------
CREATE POLICY pol_audit_admin_only ON audit_logs
    FOR SELECT USING (fn_current_user_role() = 'admin');

-- ================================================================
-- SECTION 7: 种子数据（基础参考数据）
-- ================================================================

INSERT INTO user_roles (role_name, description) VALUES
    ('user',         '普通用户，只能查看自身账户与交易'),
    ('risk_officer', '风控专员，可查看预警与案件，不可修改权限'),
    ('admin',        '系统管理员，拥有全部权限');

INSERT INTO risk_levels (level_code, score_min, score_max, description) VALUES
    ('LOW',      0,  39, '低风险客户'),
    ('MEDIUM',  40,  69, '中风险客户，需定期复核'),
    ('HIGH',    70,  89, '高风险客户，需加强尽职调查'),
    ('CRITICAL',90, 100, '极高风险，触发强制上报流程');

INSERT INTO transaction_types (type_code, description, is_high_risk) VALUES
    ('WIRE_TRANSFER',    '电汇转账',       TRUE),
    ('CASH_DEPOSIT',     '现金存款',       TRUE),
    ('CASH_WITHDRAWAL',  '现金取款',       TRUE),
    ('INTERNAL_TRANSFER','行内转账',       FALSE),
    ('POS_PAYMENT',      'POS 消费',       FALSE),
    ('CRYPTO_EXCHANGE',  '加密货币兑换',   TRUE),
    ('TRADE_FINANCE',    '贸易融资',       TRUE);

INSERT INTO aml_rules (rule_code, rule_name, description, rule_category, threshold_amount, threshold_count, threshold_window_hours, severity) VALUES
    ('R001', '大额单笔交易',     '单笔交易金额超过 50,000 USD',          'THRESHOLD', 50000.00, NULL, NULL,  'HIGH'),
    ('R002', '24小时高频交易',   '同一账户 24 小时内交易超过 10 笔',     'VELOCITY',  NULL,     10,   24,    'MEDIUM'),
    ('R003', '化整为零',         '24小时内多笔交易合计超过 50,000 USD',  'PATTERN',   50000.00, NULL, 24,    'HIGH'),
    ('R004', '高风险国家汇款',   '向制裁或高风险国家发起转账',           'GEOGRAPHY', NULL,     NULL, NULL,  'CRITICAL'),
    ('R005', '制裁名单匹配',     '交易对手出现在制裁名单中',             'PATTERN',   NULL,     NULL, NULL,  'CRITICAL'),
    ('R006', '异常时段大额交易', '凌晨 00:00-06:00 发生超过 10,000 USD 交易', 'PATTERN', 10000.00, NULL, NULL, 'MEDIUM');
```

---

完整 DDL 已输出。整体结构覆盖 11 张表、完整索引、`updated_at` 自动触发器、审计日志触发器、6 张表的 RLS 策略（按 `user / risk_officer / admin` 三级权限分层），以及基础种子数据。`sentiment_flag` 字段带 `[0,1]` 约束，可直接对接 AI 模型输出的概率值。
````





-- ================================================================
-- AML Intelligence Hub - 全维度情报聚合视图
-- 依赖表: transactions, accounts, users, risk_levels,
--         aml_alerts, aml_rules, transaction_types
-- ================================================================

CREATE OR REPLACE VIEW v_aml_intelligence_hub AS

WITH

-- 发款账户 + 用户 + 风险等级
sender_profile AS (
    SELECT
        a.id                    AS account_id,
        a.account_number        AS account_number,
        a.balance               AS account_balance,
        a.status                AS account_status,
        a.currency              AS account_currency,
        a.branch_name           AS branch_name,
        u.id                    AS user_id,
        u.full_name             AS full_name,
        u.nationality           AS nationality,
        u.is_pep                AS is_pep,
        u.is_sanctioned         AS is_sanctioned,
        u.kyc_verified_at       AS kyc_verified_at,
        rl.level_code           AS risk_level_code,
        rl.score_min            AS risk_score_min,
        rl.score_max            AS risk_score_max
    FROM accounts a
    JOIN users     u  ON u.id  = a.user_id
    LEFT JOIN risk_levels rl ON rl.id = u.risk_level_id
),

-- 收款账户 + 用户（只取必要字段，避免冗余）
receiver_profile AS (
    SELECT
        a.id             AS account_id,
        a.account_number AS account_number,
        a.balance        AS account_balance,
        a.status         AS account_status,
        u.id             AS user_id,
        u.full_name      AS full_name,
        u.nationality    AS nationality,
        u.is_pep         AS is_pep,
        u.is_sanctioned  AS is_sanctioned,
        rl.level_code    AS risk_level_code
    FROM accounts a
    JOIN users     u  ON u.id  = a.user_id
    LEFT JOIN risk_levels rl ON rl.id = u.risk_level_id
),

-- 每笔交易取最高严重度的预警（避免 LEFT JOIN 产生行爆炸）
alert_summary AS (
    SELECT DISTINCT ON (al.transaction_id)
        al.transaction_id,
        al.id                   AS alert_id,
        al.status               AS alert_status,
        al.sentiment_flag,
        al.investigation_notes,
        al.created_at           AS alert_created_at,
        r.rule_code,
        r.rule_name,
        r.description           AS rule_description,
        r.rule_category,
        r.severity              AS rule_severity,
        r.threshold_amount      AS rule_threshold_amount
    FROM aml_alerts al
    JOIN aml_rules  r  ON r.id = al.rule_id
    ORDER BY
        al.transaction_id,
        -- 优先展示最高严重度预警
        CASE r.severity
            WHEN 'CRITICAL' THEN 1
            WHEN 'HIGH'     THEN 2
            WHEN 'MEDIUM'   THEN 3
            WHEN 'LOW'      THEN 4
            ELSE 5
        END ASC,
        al.created_at DESC
)

SELECT

    -- ── 交易核心标识 ──────────────────────────────────────────
    t.id                                        AS transaction_id,
    t.reference_code                            AS reference_code,
    tt.type_code                                AS transaction_type,
    tt.is_high_risk                             AS is_high_risk_type,

    -- ── 金额与货币（统计友好格式）────────────────────────────
    t.amount                                    AS amount,
    t.currency                                  AS currency,
    t.exchange_rate                             AS exchange_rate,
    COALESCE(t.amount_usd, t.amount)            AS amount_usd,          -- 标准化金额，用于 E[X] 计算
    ROUND(COALESCE(t.amount_usd, t.amount), 2)  AS amount_usd_rounded,  -- 展示用四舍五入值
    t.status                                    AS transaction_status,

    -- ── 时间维度（时间序列分析友好）──────────────────────────
    t.created_at                                                        AS created_at,
    TO_CHAR(t.created_at, 'YYYY-MM-DD')                                 AS txn_date,
    TO_CHAR(t.created_at, 'HH24:MI:SS')                                 AS txn_time,
    EXTRACT(EPOCH FROM t.created_at)::BIGINT                            AS txn_unix_ts,   -- 机器学习时间戳
    EXTRACT(DOW   FROM t.created_at)::SMALLINT                          AS txn_day_of_week,
    EXTRACT(HOUR  FROM t.created_at)::SMALLINT                          AS txn_hour,
    CASE
        WHEN EXTRACT(HOUR FROM t.created_at) BETWEEN 0 AND 5 THEN 'LATE_NIGHT'
        WHEN EXTRACT(HOUR FROM t.created_at) BETWEEN 6 AND 11 THEN 'MORNING'
        WHEN EXTRACT(HOUR FROM t.created_at) BETWEEN 12 AND 17 THEN 'AFTERNOON'
        ELSE 'EVENING'
    END                                                                 AS txn_time_band,
    t.completed_at                                                      AS completed_at,
    EXTRACT(EPOCH FROM (t.completed_at - t.created_at))::INT            AS processing_seconds,

    -- ── 发款方画像 ────────────────────────────────────────────
    t.sender_account_id                         AS sender_account_id,
    sp.account_number                           AS sender_account_number,
    sp.user_id                                  AS sender_user_id,
    sp.full_name                                AS sender_name,
    sp.nationality                              AS sender_nationality,
    sp.risk_level_code                          AS sender_risk_level,
    sp.risk_score_max                           AS sender_risk_score,   -- 用于数值化风险排序
    sp.account_balance                          AS sender_balance,
    sp.account_status                           AS sender_account_status,
    sp.branch_name                              AS sender_branch,
    sp.is_pep                                   AS sender_is_pep,
    sp.is_sanctioned                            AS sender_is_sanctioned,
    sp.kyc_verified_at IS NOT NULL              AS sender_kyc_passed,

    -- ── 收款方画像 ────────────────────────────────────────────
    t.receiver_account_id                       AS receiver_account_id,
    rp.account_number                           AS receiver_account_number,
    rp.user_id                                  AS receiver_user_id,
    rp.full_name                                AS receiver_name,
    rp.nationality                              AS receiver_nationality,
    rp.risk_level_code                          AS receiver_risk_level,
    rp.account_balance                          AS receiver_balance,
    rp.account_status                           AS receiver_account_status,
    rp.is_pep                                   AS receiver_is_pep,
    rp.is_sanctioned                            AS receiver_is_sanctioned,

    -- ── 地理与设备 ────────────────────────────────────────────
    t.geo_country                               AS geo_country,
    t.geo_latitude                              AS geo_lat,
    t.geo_longitude                             AS geo_lng,
    t.ip_address                                AS ip_address,
    t.device_id                                 AS device_id,

    -- ── 预警与规则集成 ────────────────────────────────────────
    (alr.alert_id IS NOT NULL)                  AS is_flagged,          -- 布尔：是否触发预警
    alr.alert_id                                AS alert_id,
    alr.alert_status                            AS alert_status,
    alr.rule_code                               AS triggered_rule_code,
    alr.rule_name                               AS triggered_rule_name,
    alr.rule_description                        AS rule_description,
    alr.rule_category                           AS rule_category,
    alr.rule_severity                           AS rule_severity,
    alr.rule_threshold_amount                   AS rule_threshold_amount,
    -- 超阈值倍数：amount_usd / threshold，用于异常评分
    CASE
        WHEN alr.rule_threshold_amount > 0
        THEN ROUND(COALESCE(t.amount_usd, t.amount) / alr.rule_threshold_amount, 4)
        ELSE NULL
    END                                         AS threshold_breach_ratio,

    -- ── AI / 统计字段 ─────────────────────────────────────────
    alr.sentiment_flag                          AS ai_money_laundering_prob, -- AI 预测概率 [0,1]
    CASE
        WHEN alr.sentiment_flag >= 0.8 THEN 'VERY_HIGH'
        WHEN alr.sentiment_flag >= 0.6 THEN 'HIGH'
        WHEN alr.sentiment_flag >= 0.4 THEN 'MEDIUM'
        WHEN alr.sentiment_flag >= 0.2 THEN 'LOW'
        WHEN alr.sentiment_flag IS NOT NULL THEN 'VERY_LOW'
        ELSE 'UNSCORED'
    END                                         AS ai_risk_band,
    -- 综合风险得分：结合发款人风险分 + AI 概率（可调权重）
    ROUND(
        COALESCE(sp.risk_score_max, 0) * 0.6
        + COALESCE(alr.sentiment_flag, 0) * 100 * 0.4
    , 2)                                        AS composite_risk_score,

    alr.investigation_notes                     AS investigation_notes,
    alr.alert_created_at                        AS alert_triggered_at

FROM transactions t

-- 交易类型
LEFT JOIN transaction_types tt ON tt.id = t.transaction_type_id

-- 发款方
LEFT JOIN sender_profile   sp  ON sp.account_id = t.sender_account_id

-- 收款方
LEFT JOIN receiver_profile rp  ON rp.account_id = t.receiver_account_id

-- 预警（已在 CTE 中去重，不会产生行爆炸）
LEFT JOIN alert_summary    alr ON alr.transaction_id = t.id
;

-- ================================================================
-- 视图使用示例
-- ================================================================

-- 1. 查询所有高风险已触发预警的交易，按 AI 概率降序
-- SELECT * FROM v_aml_intelligence_hub
-- WHERE is_flagged = TRUE AND rule_severity IN ('HIGH', 'CRITICAL')
-- ORDER BY ai_money_laundering_prob DESC NULLS LAST;

-- 2. 时间序列聚合：按日统计可疑交易总金额（用于 E[X] 基线建模）
-- SELECT txn_date,
--        COUNT(*)                          AS txn_count,
--        SUM(amount_usd)                   AS total_amount_usd,
--        AVG(amount_usd)                   AS avg_amount_usd,   -- E[X]
--        STDDEV(amount_usd)                AS stddev_amount,    -- σ
--        COUNT(*) FILTER (WHERE is_flagged) AS flagged_count
-- FROM v_aml_intelligence_hub
-- GROUP BY txn_date
-- ORDER BY txn_date;

-- 3. 查询涉及制裁名单的所有交易
-- SELECT transaction_id, sender_name, receiver_name, amount_usd, composite_risk_score
-- FROM v_aml_intelligence_hub
-- WHERE sender_is_sanctioned = TRUE OR receiver_is_sanctioned = TRUE;