import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @OrgId() parameter decorator — extracts the validated organization ID
 * from the request (attached by OrgMemberGuard).
 *
 * Usage:
 *   @Get()
 *   @UseGuards(JwtAuthGuard, OrgMemberGuard)
 *   async listForms(@OrgId() orgId: string) {
 *     return this.formsService.listForms(orgId);
 *   }
 */
export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.orgId;
  },
);
