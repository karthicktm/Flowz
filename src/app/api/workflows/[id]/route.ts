import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { useSQLite, sqliteDb, postgresDb } from '@/lib/db';
import { workflowsTableSQLite, workflowsTablePostgres } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/workflows/[id]
 * Update workflow trigger configuration
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();

    if (useSQLite) {
      if (!sqliteDb) {
        throw new Error('SQLite database not initialized');
      }

      // Verify workflow belongs to user (SQLite)
      const workflows = await sqliteDb
        .select()
        .from(workflowsTableSQLite)
        .where(
          and(
            eq(workflowsTableSQLite.id, id),
            eq(workflowsTableSQLite.userId, session.user.id)
          )
        )
        .limit(1);

      if (workflows.length === 0) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
      }

      const workflow = workflows[0];

      // Update status
      if (body.status !== undefined) {
        await sqliteDb
          .update(workflowsTableSQLite)
          .set({
            status: body.status,
          })
          .where(
            and(
              eq(workflowsTableSQLite.id, id),
              eq(workflowsTableSQLite.userId, session.user.id)
            )
          );

        logger.info(
          {
            userId: session.user.id,
            workflowId: id,
            status: body.status,
          },
          'Workflow status updated'
        );

        return NextResponse.json({ success: true, status: body.status });
      }

      // Update trigger config
      if (body.trigger) {
        const updatedTrigger = {
          ...workflow.trigger,
          config: {
            ...(workflow.trigger as { type: string; config: Record<string, unknown> }).config,
            ...body.trigger.config,
          },
        };

        await sqliteDb
          .update(workflowsTableSQLite)
          .set({
            trigger: updatedTrigger,
          })
          .where(
            and(
              eq(workflowsTableSQLite.id, id),
              eq(workflowsTableSQLite.userId, session.user.id)
            )
          );

        logger.info(
          {
            userId: session.user.id,
            workflowId: id,
            triggerType: updatedTrigger.type,
          },
          'Workflow trigger config updated'
        );

        return NextResponse.json({ success: true, trigger: updatedTrigger });
      }

      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    } else {
      if (!postgresDb) {
        throw new Error('PostgreSQL database not initialized');
      }

      // Verify workflow belongs to user (PostgreSQL)
      const workflows = await postgresDb
        .select()
        .from(workflowsTablePostgres)
        .where(
          and(
            eq(workflowsTablePostgres.id, id),
            eq(workflowsTablePostgres.userId, session.user.id)
          )
        )
        .limit(1);

      if (workflows.length === 0) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
      }

      const workflow = workflows[0];

      // Update status
      if (body.status !== undefined) {
        await postgresDb
          .update(workflowsTablePostgres)
          .set({
            status: body.status,
          })
          .where(
            and(
              eq(workflowsTablePostgres.id, id),
              eq(workflowsTablePostgres.userId, session.user.id)
            )
          );

        logger.info(
          {
            userId: session.user.id,
            workflowId: id,
            status: body.status,
          },
          'Workflow status updated'
        );

        return NextResponse.json({ success: true, status: body.status });
      }

      // Update trigger config
      if (body.trigger) {
        const updatedTrigger = {
          ...workflow.trigger,
          config: {
            ...(workflow.trigger as { type: string; config: Record<string, unknown> }).config,
            ...body.trigger.config,
          },
        };

        await postgresDb
          .update(workflowsTablePostgres)
          .set({
            trigger: updatedTrigger,
          })
          .where(
            and(
              eq(workflowsTablePostgres.id, id),
              eq(workflowsTablePostgres.userId, session.user.id)
            )
          );

        logger.info(
          {
            userId: session.user.id,
            workflowId: id,
            triggerType: updatedTrigger.type,
          },
          'Workflow trigger config updated'
        );

        return NextResponse.json({ success: true, trigger: updatedTrigger });
      }

      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }
  } catch (error) {
    logger.error({ error }, 'Failed to update workflow');
    return NextResponse.json(
      { error: 'Failed to update workflow' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workflows/[id]
 * Delete a workflow
 * Supports both SQLite and PostgreSQL
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;

    if (useSQLite) {
      if (!sqliteDb) {
        throw new Error('SQLite database not initialized');
      }

      // Verify workflow belongs to user before deleting (SQLite)
      const workflows = await sqliteDb
        .select()
        .from(workflowsTableSQLite)
        .where(
          and(
            eq(workflowsTableSQLite.id, id),
            eq(workflowsTableSQLite.userId, session.user.id)
          )
        )
        .limit(1);

      if (workflows.length === 0) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
      }

      await sqliteDb
        .delete(workflowsTableSQLite)
        .where(
          and(
            eq(workflowsTableSQLite.id, id),
            eq(workflowsTableSQLite.userId, session.user.id)
          )
        );

      logger.info(
        {
          userId: session.user.id,
          workflowId: id,
        },
        'Workflow deleted'
      );

      return NextResponse.json({ success: true });
    } else {
      if (!postgresDb) {
        throw new Error('PostgreSQL database not initialized');
      }

      // Verify workflow belongs to user before deleting (PostgreSQL)
      const workflows = await postgresDb
        .select()
        .from(workflowsTablePostgres)
        .where(
          and(
            eq(workflowsTablePostgres.id, id),
            eq(workflowsTablePostgres.userId, session.user.id)
          )
        )
        .limit(1);

      if (workflows.length === 0) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
      }

      await postgresDb
        .delete(workflowsTablePostgres)
        .where(
          and(
            eq(workflowsTablePostgres.id, id),
            eq(workflowsTablePostgres.userId, session.user.id)
          )
        );

      logger.info(
        {
          userId: session.user.id,
          workflowId: id,
        },
        'Workflow deleted'
      );

      return NextResponse.json({ success: true });
    }
  } catch (error) {
    logger.error({ error }, 'Failed to delete workflow');
    return NextResponse.json(
      { error: 'Failed to delete workflow' },
      { status: 500 }
    );
  }
}
