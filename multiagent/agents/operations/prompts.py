"""Operations agent prompts — Re-export English prompts from main prompts.py

All prompts are now centralized in agents/prompts.py (English) for optimal AI performance.
This file re-exports them for backward compatibility with operations/orchestrator.py.
"""

from agents.prompts import (
    ACCOUNTING_AGENT_PROMPT,
    AFTER_SERVICE_AGENT_PROMPT,
    CONSULTATION_AGENT_PROMPT,
    INSTALLATION_AGENT_PROMPT,
    MANUFACTURING_AGENT_PROMPT,
    NOTIFICATION_AGENT_PROMPT,
    ORDERING_AGENT_PROMPT,
    SCHEDULE_AGENT_PROMPT,
)

__all__ = [
    "CONSULTATION_AGENT_PROMPT",
    "ORDERING_AGENT_PROMPT",
    "MANUFACTURING_AGENT_PROMPT",
    "INSTALLATION_AGENT_PROMPT",
    "AFTER_SERVICE_AGENT_PROMPT",
    "ACCOUNTING_AGENT_PROMPT",
    "SCHEDULE_AGENT_PROMPT",
    "NOTIFICATION_AGENT_PROMPT",
]
