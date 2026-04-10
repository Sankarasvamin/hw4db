from __future__ import annotations

import os
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from faker import Faker
from supabase import ClientOptions, create_client

SEED = 20260410
USER_COUNT = 20
TOTAL_TRANSACTIONS = 500
STRUCTURING_GROUPS = 5
STRUCTURING_TXNS_PER_GROUP = 5
NORMAL_TRANSACTION_COUNT = TOTAL_TRANSACTIONS - (
    STRUCTURING_GROUPS * STRUCTURING_TXNS_PER_GROUP
)
ROOT_DIR = Path(__file__).resolve().parent


@dataclass
class UserSeed:
    id: str
    full_name: str
    email: str
    role_name: str
    nationality: str


@dataclass
class AccountSeed:
    id: str
    user_id: str
    account_number: str
    nationality: str


def log(message: str) -> None:
    stamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{stamp}] {message}")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso_dt(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def round_money(value: float) -> float:
    return round(float(value), 4)


def load_settings() -> tuple[str, str]:
    env_path = ROOT_DIR / ".env"
    load_dotenv(env_path)

    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    supabase_key = (
        os.getenv("SUPABASE_KEY")
        or os.getenv("VITE_SUPABASE_KEY")
        or os.getenv("VITE_SUPABASE_ANON_KEY")
    )

    if not supabase_url or not supabase_key:
        raise RuntimeError(
            "未找到 Supabase 配置，请在 .env 中提供 SUPABASE_URL / SUPABASE_KEY "
            "或 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。"
        )

    return supabase_url, supabase_key


def build_client():
    supabase_url, supabase_key = load_settings()
    http_client = httpx.Client(trust_env=False, timeout=30.0)
    options = ClientOptions(
        auto_refresh_token=False,
        persist_session=False,
        httpx_client=http_client,
    )
    client = create_client(supabase_url, supabase_key, options=options)
    return client, http_client


def ensure_reference_rows(
    client: Any, table_name: str, key_field: str, rows: list[dict[str, Any]]
) -> dict[str, str]:
    existing = client.table(table_name).select(f"id,{key_field}").execute().data or []
    value_to_id = {
        row[key_field]: row["id"]
        for row in existing
        if row.get(key_field) in {item[key_field] for item in rows}
    }

    missing = [row for row in rows if row[key_field] not in value_to_id]
    if missing:
        inserted = client.table(table_name).insert(missing).execute().data or []
        for row in inserted:
            value_to_id[row[key_field]] = row["id"]

    return value_to_id


def insert_rows(
    client: Any, table_name: str, rows: list[dict[str, Any]], chunk_size: int = 100
) -> list[dict[str, Any]]:
    inserted_rows: list[dict[str, Any]] = []
    total = len(rows)

    for start in range(0, total, chunk_size):
        chunk = rows[start : start + chunk_size]
        response = client.table(table_name).insert(chunk).execute()
        data = response.data or []
        if isinstance(data, dict):
            data = [data]
        inserted_rows.extend(data)
        log(f"{table_name}: 已插入 {len(inserted_rows)}/{total}")

    return inserted_rows


def choose_weighted(options: list[tuple[str, float]]) -> str:
    values = [item[0] for item in options]
    weights = [item[1] for item in options]
    return random.choices(values, weights=weights, k=1)[0]


def generate_balance() -> float:
    value = random.lognormvariate(8.9, 1.0)
    value = max(500.0, min(value, 2_500_000.0))
    return round_money(value)


def generate_normal_amount() -> float:
    value = random.gammavariate(2.2, 780.0)
    value = max(100.0, min(value, 5000.0))
    return round_money(value)


def build_role_rows() -> list[dict[str, Any]]:
    return [
        {
            "role_name": "admin",
            "description": "系统管理员，可维护规则与查看所有风控数据。",
        },
        {
            "role_name": "investigator",
            "description": "反洗钱调查员，负责处理预警与案件跟踪。",
        },
        {
            "role_name": "customer",
            "description": "普通银行客户，产生账户与交易行为。",
        },
    ]


def build_risk_level_rows() -> list[dict[str, Any]]:
    return [
        {
            "level_code": "LOW",
            "score_min": 0,
            "score_max": 25,
            "description": "低风险客户",
        },
        {
            "level_code": "MEDIUM",
            "score_min": 26,
            "score_max": 60,
            "description": "中风险客户",
        },
        {
            "level_code": "HIGH",
            "score_min": 61,
            "score_max": 85,
            "description": "高风险客户",
        },
        {
            "level_code": "CRITICAL",
            "score_min": 86,
            "score_max": 100,
            "description": "极高风险客户",
        },
    ]


def build_transaction_type_rows() -> list[dict[str, Any]]:
    return [
        {
            "type_code": "INTERNAL_TRANSFER",
            "description": "行内账户转账",
            "is_high_risk": False,
        },
        {
            "type_code": "DOMESTIC_WIRE",
            "description": "境内电汇",
            "is_high_risk": False,
        },
        {
            "type_code": "INTERNATIONAL_WIRE",
            "description": "跨境电汇",
            "is_high_risk": True,
        },
    ]


def build_user_rows(
    faker: Faker, role_ids: dict[str, str], risk_level_ids: dict[str, str]
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    role_sequence = ["admin"] * 2 + ["investigator"] * 4 + ["customer"] * 14
    random.shuffle(role_sequence)
    seed_tag = datetime.now().strftime("%Y%m%d%H%M%S")

    user_rows: list[dict[str, Any]] = []
    metadata_by_email: dict[str, dict[str, Any]] = {}

    for index, role_name in enumerate(role_sequence, start=1):
        nationality = faker.country_code(representation="alpha-2")
        if role_name == "admin":
            risk_level = choose_weighted([("LOW", 0.7), ("MEDIUM", 0.3)])
        elif role_name == "investigator":
            risk_level = choose_weighted([("LOW", 0.4), ("MEDIUM", 0.5), ("HIGH", 0.1)])
        else:
            risk_level = choose_weighted(
                [("LOW", 0.35), ("MEDIUM", 0.4), ("HIGH", 0.2), ("CRITICAL", 0.05)]
            )

        created_at = now_utc() - timedelta(days=random.randint(60, 900))
        kyc_verified_at = created_at + timedelta(days=random.randint(1, 20))
        email = f"aml_user_{seed_tag}_{index:02d}@example.com"
        row = {
            "full_name": faker.name(),
            "nationality": nationality,
            "id_number": f"AMLID{seed_tag}{index:04d}",
            "date_of_birth": faker.date_of_birth(minimum_age=21, maximum_age=75).isoformat(),
            "email": email,
            "phone": faker.phone_number()[:30],
            "risk_level_id": risk_level_ids[risk_level],
            "role_id": role_ids[role_name],
            "is_pep": role_name == "customer" and random.random() < 0.10,
            "is_sanctioned": role_name == "customer" and random.random() < 0.03,
            "kyc_verified_at": iso_dt(kyc_verified_at),
            "created_at": iso_dt(created_at),
            "updated_at": iso_dt(created_at),
        }
        user_rows.append(row)
        metadata_by_email[email] = {
            "role_name": role_name,
            "nationality": nationality,
        }

    return user_rows, metadata_by_email


def build_account_rows(
    users: list[UserSeed],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    branch_names = [
        ("001", "New York Main Branch"),
        ("002", "San Francisco Branch"),
        ("003", "Chicago Branch"),
        ("004", "Singapore Offshore Desk"),
        ("005", "London Correspondent Desk"),
    ]
    account_type_weights = [
        ("CHECKING", 0.55),
        ("SAVINGS", 0.30),
        ("BUSINESS", 0.15),
    ]

    account_rows: list[dict[str, Any]] = []
    metadata_by_number: dict[str, dict[str, Any]] = {}
    seed_tag = datetime.now().strftime("%Y%m%d%H%M%S")

    account_index = 0
    for user in users:
        account_count = 1 if random.random() < 0.55 else 2
        for local_index in range(1, account_count + 1):
            account_index += 1
            branch_code, branch_name = random.choice(branch_names)
            account_number = (
                f"US{seed_tag[-8:]}{account_index:05d}{local_index:02d}"
                f"{random.randint(100000, 999999)}"
            )[:34]
            opened_at = now_utc() - timedelta(days=random.randint(30, 720))
            row = {
                "account_number": account_number,
                "user_id": user.id,
                "currency": "USD",
                "balance": generate_balance(),
                "branch_code": branch_code,
                "branch_name": branch_name,
                "account_type": choose_weighted(account_type_weights),
                "status": "ACTIVE",
                "opened_at": iso_dt(opened_at),
                "created_at": iso_dt(opened_at),
                "updated_at": iso_dt(opened_at),
            }
            account_rows.append(row)
            metadata_by_number[account_number] = {
                "user_id": user.id,
                "nationality": user.nationality,
            }

    return account_rows, metadata_by_number


def pick_sender_receiver(accounts: list[AccountSeed]) -> tuple[AccountSeed, AccountSeed]:
    sender = random.choice(accounts)
    receiver = random.choice(accounts)
    while receiver.id == sender.id:
        receiver = random.choice(accounts)
    return sender, receiver


def pick_structuring_accounts(
    accounts: list[AccountSeed],
) -> tuple[AccountSeed, list[AccountSeed]]:
    receiver = random.choice(accounts)
    candidates = [acc for acc in accounts if acc.id != receiver.id and acc.user_id != receiver.user_id]
    random.shuffle(candidates)

    selected: list[AccountSeed] = []
    used_user_ids = {receiver.user_id}
    for account in candidates:
        if account.user_id in used_user_ids:
            continue
        selected.append(account)
        used_user_ids.add(account.user_id)
        if len(selected) == STRUCTURING_TXNS_PER_GROUP:
            break

    if len(selected) != STRUCTURING_TXNS_PER_GROUP:
        raise RuntimeError("活跃账户数量不足，无法构造 5 组分拆汇款样本。")

    return receiver, selected


def build_transaction_rows(
    faker: Faker,
    accounts: list[AccountSeed],
    transaction_type_ids: dict[str, str],
) -> tuple[list[dict[str, Any]], set[str]]:
    transaction_rows: list[dict[str, Any]] = []
    suspicious_references: set[str] = set()
    seed_tag = datetime.now().strftime("%Y%m%d%H%M%S")
    recent_countries = ["US", "SG", "GB", "AE", "HK", "CH", "CA"]

    for index in range(1, NORMAL_TRANSACTION_COUNT + 1):
        sender, receiver = pick_sender_receiver(accounts)
        created_at = now_utc() - timedelta(
            days=random.randint(1, 60),
            hours=random.randint(0, 23),
            minutes=random.randint(0, 59),
        )
        status = choose_weighted(
            [("COMPLETED", 0.88), ("PENDING", 0.08), ("FAILED", 0.04)]
        )
        txn_type = choose_weighted(
            [
                ("INTERNAL_TRANSFER", 0.55),
                ("DOMESTIC_WIRE", 0.30),
                ("INTERNATIONAL_WIRE", 0.15),
            ]
        )
        amount = generate_normal_amount()
        completed_at = None
        if status in {"COMPLETED", "FAILED"}:
            completed_at = iso_dt(created_at + timedelta(minutes=random.randint(1, 45)))

        row = {
            "sender_account_id": sender.id,
            "receiver_account_id": receiver.id,
            "transaction_type_id": transaction_type_ids[txn_type],
            "amount": amount,
            "currency": "USD",
            "exchange_rate": 1.0,
            "amount_usd": amount,
            "status": status,
            "geo_latitude": round(random.uniform(-45.0, 60.0), 6),
            "geo_longitude": round(random.uniform(-120.0, 140.0), 6),
            "geo_country": random.choice(recent_countries),
            "ip_address": faker.ipv4_public(),
            "reference_code": f"TXN-{seed_tag}-{index:04d}",
            "description": f"{txn_type} synthetic transaction",
            "created_at": iso_dt(created_at),
            "completed_at": completed_at,
        }
        transaction_rows.append(row)

    for group_index in range(1, STRUCTURING_GROUPS + 1):
        receiver, senders = pick_structuring_accounts(accounts)
        window_start = now_utc() - timedelta(
            days=random.randint(2, 25),
            hours=random.randint(0, 12),
        )
        for txn_index, sender in enumerate(senders, start=1):
            created_at = window_start + timedelta(minutes=random.randint(0, 29))
            reference_code = f"STR-{seed_tag}-G{group_index}-T{txn_index}"
            row = {
                "sender_account_id": sender.id,
                "receiver_account_id": receiver.id,
                "transaction_type_id": transaction_type_ids["INTERNATIONAL_WIRE"],
                "amount": 9000.0,
                "currency": "USD",
                "exchange_rate": 1.0,
                "amount_usd": 9000.0,
                "status": "FLAGGED",
                "geo_latitude": round(random.uniform(-10.0, 45.0), 6),
                "geo_longitude": round(random.uniform(-30.0, 120.0), 6),
                "geo_country": choose_weighted([("AE", 0.35), ("HK", 0.25), ("SG", 0.2), ("GB", 0.2)]),
                "ip_address": faker.ipv4_public(),
                "reference_code": reference_code,
                "description": (
                    "Manual AML structuring test: 5 senders transfer 9000 USD to one "
                    "receiver within 30 minutes."
                ),
                "created_at": iso_dt(created_at),
                "completed_at": iso_dt(created_at + timedelta(minutes=random.randint(2, 12))),
            }
            transaction_rows.append(row)
            suspicious_references.add(reference_code)

    random.shuffle(transaction_rows)
    return transaction_rows, suspicious_references


def build_rule_rows(created_by: str) -> list[dict[str, Any]]:
    return [
        {
            "rule_code": "STRUCTURING_30M",
            "rule_name": "30分钟内分拆汇款识别",
            "description": "30 分钟窗口内，5 个不同账户向同一目标账户转入接近监管阈值的资金。",
            "rule_category": "PATTERN",
            "threshold_amount": 9000.0,
            "threshold_count": 5,
            "threshold_window_hours": 1,
            "severity": "HIGH",
            "is_active": True,
            "created_by": created_by,
        },
        {
            "rule_code": "LARGE_TRANSFER_10000",
            "rule_name": "大额单笔转账阈值",
            "description": "单笔转账金额达到或超过 10000 USD 时触发审查。",
            "rule_category": "THRESHOLD",
            "threshold_amount": 10000.0,
            "threshold_count": None,
            "threshold_window_hours": None,
            "severity": "MEDIUM",
            "is_active": True,
            "created_by": created_by,
        },
        {
            "rule_code": "HIGH_VELOCITY_24H",
            "rule_name": "24小时高频转出监测",
            "description": "24 小时内同一账户连续发起多笔转出交易时触发监测。",
            "rule_category": "VELOCITY",
            "threshold_amount": None,
            "threshold_count": 10,
            "threshold_window_hours": 24,
            "severity": "MEDIUM",
            "is_active": True,
            "created_by": created_by,
        },
    ]


def build_alert_rows(
    transactions: list[dict[str, Any]],
    suspicious_references: set[str],
    rule_id: str,
    investigator_ids: list[str],
) -> list[dict[str, Any]]:
    alert_rows: list[dict[str, Any]] = []
    for transaction in transactions:
        if transaction["reference_code"] not in suspicious_references:
            continue
        created_at = datetime.fromisoformat(transaction["created_at"])
        alert_rows.append(
            {
                "transaction_id": transaction["id"],
                "rule_id": rule_id,
                "triggered_amount": 9000.0,
                "status": "PENDING",
                "assigned_to": random.choice(investigator_ids),
                "investigation_notes": (
                    "Auto-generated from manual structuring seed data. "
                    "Five different origin accounts funneled funds to one target account."
                ),
                "resolution_notes": None,
                "sentiment_flag": round(random.uniform(0.91, 0.99), 4),
                "created_at": iso_dt(created_at + timedelta(minutes=3)),
                "updated_at": iso_dt(created_at + timedelta(minutes=3)),
            }
        )
    return alert_rows


def build_audit_rows(
    admin_user_id: str,
    investigator_user_ids: list[str],
    created_users: list[dict[str, Any]],
    created_accounts: list[dict[str, Any]],
    created_transactions: list[dict[str, Any]],
    created_rules: dict[str, str],
    created_alerts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    created_at = now_utc()
    audit_rows = [
        {
            "actor_user_id": admin_user_id,
            "actor_role": "admin",
            "action": "LOGIN",
            "resource_type": "auth",
            "resource_id": None,
            "query_summary": "Seed operator authenticated to initialize AML demo data.",
            "ip_address": "127.0.0.1",
            "user_agent": "seed_supabase_aml.py/1.0",
            "success": True,
            "metadata": {"seed": SEED},
            "created_at": iso_dt(created_at),
        },
        {
            "actor_user_id": admin_user_id,
            "actor_role": "admin",
            "action": "INSERT",
            "resource_type": "users",
            "resource_id": created_users[0]["id"],
            "query_summary": f"Inserted {len(created_users)} synthetic users.",
            "ip_address": "127.0.0.1",
            "user_agent": "seed_supabase_aml.py/1.0",
            "success": True,
            "metadata": {"records": len(created_users)},
            "created_at": iso_dt(created_at + timedelta(seconds=5)),
        },
        {
            "actor_user_id": admin_user_id,
            "actor_role": "admin",
            "action": "INSERT",
            "resource_type": "accounts",
            "resource_id": created_accounts[0]["id"],
            "query_summary": f"Inserted {len(created_accounts)} customer accounts.",
            "ip_address": "127.0.0.1",
            "user_agent": "seed_supabase_aml.py/1.0",
            "success": True,
            "metadata": {"records": len(created_accounts)},
            "created_at": iso_dt(created_at + timedelta(seconds=10)),
        },
        {
            "actor_user_id": admin_user_id,
            "actor_role": "admin",
            "action": "INSERT",
            "resource_type": "transactions",
            "resource_id": created_transactions[0]["id"],
            "query_summary": f"Inserted {len(created_transactions)} synthetic transactions.",
            "ip_address": "127.0.0.1",
            "user_agent": "seed_supabase_aml.py/1.0",
            "success": True,
            "metadata": {"records": len(created_transactions)},
            "created_at": iso_dt(created_at + timedelta(seconds=15)),
        },
        {
            "actor_user_id": admin_user_id,
            "actor_role": "admin",
            "action": "INSERT",
            "resource_type": "aml_rules",
            "resource_id": created_rules["STRUCTURING_30M"],
            "query_summary": f"Ensured {len(created_rules)} AML rules exist.",
            "ip_address": "127.0.0.1",
            "user_agent": "seed_supabase_aml.py/1.0",
            "success": True,
            "metadata": {"rule_codes": list(created_rules.keys())},
            "created_at": iso_dt(created_at + timedelta(seconds=20)),
        },
    ]

    for index, alert in enumerate(created_alerts[:10], start=1):
        investigator_id = investigator_user_ids[(index - 1) % len(investigator_user_ids)]
        audit_rows.append(
            {
                "actor_user_id": investigator_id,
                "actor_role": "investigator",
                "action": "SELECT",
                "resource_type": "aml_alerts",
                "resource_id": alert["id"],
                "query_summary": "Reviewed system-generated structuring alert queue.",
                "ip_address": "10.0.0.10",
                "user_agent": "risk-console/seed-demo",
                "success": True,
                "metadata": {"alert_status": alert["status"]},
                "created_at": iso_dt(created_at + timedelta(seconds=20 + index)),
            }
        )

    return audit_rows


def main() -> None:
    random.seed(SEED)
    Faker.seed(SEED)
    faker = Faker("en_US")

    client = None
    http_client = None

    try:
        log("初始化 Supabase 客户端")
        client, http_client = build_client()

        log("准备角色、风险等级与交易类型字典表")
        role_ids = ensure_reference_rows(client, "user_roles", "role_name", build_role_rows())
        risk_level_ids = ensure_reference_rows(
            client, "risk_levels", "level_code", build_risk_level_rows()
        )
        transaction_type_ids = ensure_reference_rows(
            client, "transaction_types", "type_code", build_transaction_type_rows()
        )

        log("生成 Users 数据")
        user_rows, user_meta = build_user_rows(faker, role_ids, risk_level_ids)
        created_users_raw = insert_rows(client, "users", user_rows, chunk_size=20)
        users = [
            UserSeed(
                id=row["id"],
                full_name=row["full_name"],
                email=row["email"],
                role_name=user_meta[row["email"]]["role_name"],
                nationality=user_meta[row["email"]]["nationality"],
            )
            for row in created_users_raw
        ]

        log("生成 Accounts 数据")
        account_rows, account_meta = build_account_rows(users)
        created_accounts_raw = insert_rows(client, "accounts", account_rows, chunk_size=50)
        accounts = [
            AccountSeed(
                id=row["id"],
                user_id=account_meta[row["account_number"]]["user_id"],
                account_number=row["account_number"],
                nationality=account_meta[row["account_number"]]["nationality"],
            )
            for row in created_accounts_raw
        ]

        log("预设 AML 规则")
        admin_users = [user for user in users if user.role_name == "admin"]
        investigator_users = [user for user in users if user.role_name == "investigator"]
        if not admin_users or not investigator_users:
            raise RuntimeError("脚本生成的角色分布异常，缺少 admin 或 investigator。")

        rule_ids = ensure_reference_rows(
            client,
            "aml_rules",
            "rule_code",
            build_rule_rows(created_by=admin_users[0].id),
        )

        log("生成 500 条交易，其中包含 5 组 Structuring 异常")
        transaction_rows, suspicious_references = build_transaction_rows(
            faker, accounts, transaction_type_ids
        )
        created_transactions_raw = insert_rows(
            client, "transactions", transaction_rows, chunk_size=100
        )

        log("为异常交易自动生成 AML Alerts")
        alert_rows = build_alert_rows(
            created_transactions_raw,
            suspicious_references,
            rule_ids["STRUCTURING_30M"],
            [user.id for user in investigator_users],
        )
        created_alerts_raw = insert_rows(client, "aml_alerts", alert_rows, chunk_size=50)

        log("写入审计日志")
        audit_rows = build_audit_rows(
            admin_user_id=admin_users[0].id,
            investigator_user_ids=[user.id for user in investigator_users],
            created_users=created_users_raw,
            created_accounts=created_accounts_raw,
            created_transactions=created_transactions_raw,
            created_rules=rule_ids,
            created_alerts=created_alerts_raw,
        )
        insert_rows(client, "audit_logs", audit_rows, chunk_size=50)

        log("数据注入完成")
        log(
            "汇总: "
            f"users={len(created_users_raw)}, "
            f"accounts={len(created_accounts_raw)}, "
            f"transactions={len(created_transactions_raw)}, "
            f"alerts={len(created_alerts_raw)}"
        )
    finally:
        if client is not None:
            try:
                client.remove_all_channels()
            except Exception:
                pass
        if http_client is not None:
            http_client.close()
        log("Supabase 连接已关闭")


if __name__ == "__main__":
    main()
