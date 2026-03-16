"""add task chain fields

Revision ID: a1b2c3d4e5f6
Revises: bbe4681a2d80
Create Date: 2026-03-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '299dd384a3fb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('chain_id', sa.String(36), nullable=True))
    op.add_column('tasks', sa.Column('chain_order', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('tasks', sa.Column('chain_source_param', sa.String(100), nullable=True))
    op.create_index('ix_tasks_chain_id', 'tasks', ['chain_id'])


def downgrade() -> None:
    op.drop_index('ix_tasks_chain_id', table_name='tasks')
    op.drop_column('tasks', 'chain_source_param')
    op.drop_column('tasks', 'chain_order')
    op.drop_column('tasks', 'chain_id')
