import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { ChoiceListsService, type ChoiceItemInput } from './choice-lists.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { RequiredRole } from '../../common/decorators/roles.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';

/**
 * Choice lists, for authors.
 *
 * Reading is VIEWER — the builder needs the catalogue to offer it, and a viewer
 * looking at a submission needs labels for the values it stores. Writing is
 * EDITOR; deleting is ADMIN, matching how forms and apps are governed.
 */
@Controller('organizations/:orgId/choice-lists')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
export class ChoiceListsController {
  constructor(private readonly lists: ChoiceListsService) {}

  @Get()
  @RequiredRole('VIEWER')
  list(@OrgId() orgId: string) {
    return this.lists.listLists(orgId);
  }

  @Get(':slug')
  @RequiredRole('VIEWER')
  get(@OrgId() orgId: string, @Param('slug') slug: string) {
    return this.lists.getList(orgId, slug);
  }

  @Get(':slug/items')
  @RequiredRole('VIEWER')
  items(
    @OrgId() orgId: string,
    @Param('slug') slug: string,
    @Query() query: { parent?: string; q?: string; limit?: string; cursor?: string },
  ) {
    return this.lists.getItems(orgId, slug, {
      parent: query.parent,
      q: query.q,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
    });
  }

  @Post()
  @RequiredRole('EDITOR')
  create(
    @OrgId() orgId: string,
    @Body()
    body: {
      name: string;
      slug?: string;
      description?: string;
      parentListSlug?: string;
      metadataSchema?: unknown;
    },
    @Req() req: Request,
  ) {
    return this.lists.createList(orgId, body, (req.user as { sub?: string })?.sub);
  }

  @Patch(':slug')
  @RequiredRole('EDITOR')
  update(
    @OrgId() orgId: string,
    @Param('slug') slug: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      parentListSlug?: string | null;
      metadataSchema?: unknown;
    },
    @Req() req: Request,
  ) {
    return this.lists.updateList(orgId, slug, body, (req.user as { sub?: string })?.sub);
  }

  @Post(':slug/items')
  @RequiredRole('EDITOR')
  import(
    @OrgId() orgId: string,
    @Param('slug') slug: string,
    @Body() body: { items: ChoiceItemInput[]; mode?: 'replace' | 'merge' },
    @Req() req: Request,
  ) {
    return this.lists.importItems(orgId, slug, body, (req.user as { sub?: string })?.sub);
  }

  @Delete(':slug')
  @RequiredRole('ADMIN')
  remove(@OrgId() orgId: string, @Param('slug') slug: string, @Req() req: Request) {
    return this.lists.deleteList(orgId, slug, (req.user as { sub?: string })?.sub);
  }
}
