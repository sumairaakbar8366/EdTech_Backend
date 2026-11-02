import { BadRequestException, Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentAuth, PlatformOnly, Public } from '../auth/decorators.js';
import { CustomFormDto } from '../common/custom-form.js';
import type { AuthContext } from '../common/request-context.js';
import { EVENT_KINDS, OpportunitiesService } from './opportunities.service.js';
import { PostsService } from './posts.service.js';
import { ScholarshipsService } from './scholarships.service.js';
import { AddGrantsDto, AwardCandidatesDto, DecideCandidatesDto, DecideRequestDto, ImageCaptionDto, PostDto, ProgramDto, ScholarshipFormDto, SendOfferDto, SetGrantStatusDto, SponsorDto, SubmitRequestDto } from './sponsorship.dto.js';

type PlatformAuth = Extract<AuthContext, { scope: 'platform' }>;
const Id = () => new ParseUUIDPipe();

/** Owner console: sponsors, programs, opportunities, offers, requests and the children who receive scholarships. */
@Controller('platform/scholarships')
export class ScholarshipsAdminController {
  constructor(private readonly s: ScholarshipsService, private readonly opps: OpportunitiesService) {}

  @PlatformOnly() @Get('overview') overview() { return this.s.overview(); }
  @PlatformOnly() @Get('schools') schools() { return this.s.schools(); }
  @PlatformOnly() @Get('event-kinds') eventKinds() { return EVENT_KINDS; }

  @PlatformOnly() @Get('form') form() { return this.s.form(); }
  @PlatformOnly() @Put('form') saveForm(@CurrentAuth() a: PlatformAuth, @Body() dto: ScholarshipFormDto) { return this.s.saveForm(dto.form as CustomFormDto, a.adminId); }

  @PlatformOnly() @Get('sponsors') sponsors() { return this.s.sponsors(); }
  @PlatformOnly() @Post('sponsors') addSponsor(@Body() dto: SponsorDto) { return this.s.addSponsor(dto); }
  @PlatformOnly() @Put('sponsors/:id') updateSponsor(@Param('id', Id()) id: string, @Body() dto: SponsorDto) { return this.s.updateSponsor(id, dto); }
  @PlatformOnly() @Delete('sponsors/:id') @HttpCode(HttpStatus.NO_CONTENT) async removeSponsor(@Param('id', Id()) id: string): Promise<void> { await this.s.removeSponsor(id); }

  @PlatformOnly() @Get('programs') programs() { return this.s.programs(); }
  @PlatformOnly() @Post('programs') addProgram(@Body() dto: ProgramDto) { return this.s.addProgram(dto); }
  @PlatformOnly() @Put('programs/:id') updateProgram(@Param('id', Id()) id: string, @Body() dto: ProgramDto) { return this.s.updateProgram(id, dto); }

  @PlatformOnly() @Get('opportunities') opportunities(@Query('status') status?: string) { return this.s.opportunities(status); }
  @PlatformOnly() @Post('opportunities/:id/offer') @HttpCode(HttpStatus.OK) offerFromOpportunity(@CurrentAuth() a: PlatformAuth, @Param('id', Id()) id: string, @Body() dto: SendOfferDto) { return this.s.sendOffer(dto, id, a.adminId); }
  @PlatformOnly() @Post('opportunities/:id/dismiss') @HttpCode(HttpStatus.OK) dismiss(@Param('id', Id()) id: string) { return this.s.dismissOpportunity(id); }

  @PlatformOnly() @Get('offers') offers(@Query('status') status?: string) { return this.s.offers(status); }
  @PlatformOnly() @Post('offers') @HttpCode(HttpStatus.OK) offer(@CurrentAuth() a: PlatformAuth, @Body() dto: SendOfferDto) { return this.s.sendOffer(dto, null, a.adminId); }
  @PlatformOnly() @Post('offers/:id/withdraw') @HttpCode(HttpStatus.OK) withdraw(@Param('id', Id()) id: string) { return this.s.withdrawOffer(id); }

  @PlatformOnly() @Get('requests') requests(@Query('status') status?: string) { return this.s.requests(status); }
  @PlatformOnly() @Post('requests/:id/decision') @HttpCode(HttpStatus.OK) decide(@Param('id', Id()) id: string, @Body() dto: DecideRequestDto) { return this.s.decide(id, dto); }
  @PlatformOnly() @Post('requests/:id/grants') addGrants(@Param('id', Id()) id: string, @Body() dto: AddGrantsDto) { return this.s.addGrants(id, dto); }

  @PlatformOnly() @Get('candidates') candidates(@Query('programId', Id()) programId: string, @Query('period') period?: string, @Query('status') status?: string) { return this.s.candidates(programId, period, status); }
  @PlatformOnly() @Post('candidates/decide') @HttpCode(HttpStatus.OK) decideCandidates(@Body() dto: DecideCandidatesDto) { return this.s.decideCandidates(dto); }
  @PlatformOnly() @Post('candidates/award') @HttpCode(HttpStatus.OK) award(@Body() dto: AwardCandidatesDto) { return this.s.awardCandidates(dto); }

  @PlatformOnly() @Get('grants') grants(@Query('programId') programId?: string, @Query('schoolId') schoolId?: string) { return this.s.grants(programId, schoolId); }
  @PlatformOnly() @Post('grants/:id/status') @HttpCode(HttpStatus.OK) grantStatus(@Param('id', Id()) id: string, @Body() dto: SetGrantStatusDto) { return this.s.setGrantStatus(id, dto.status); }
}

/** The private page a school opens from the offer email: no sign-in, the link itself is the key. */
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public/scholarship-offers')
export class ScholarshipsPublicController {
  constructor(private readonly s: ScholarshipsService) {}

  @Get(':token') @Throttle({ default: { limit: 30, ttl: 60_000 } })
  offer(@Param('token') token: string) { return this.s.publicOffer(token); }

  @Post(':token') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  submit(@Param('token') token: string, @Body() dto: SubmitRequestDto) { return this.s.submit(token, dto); }

  @Post(':token/decline') @HttpCode(HttpStatus.OK) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  decline(@Param('token') token: string) { return this.s.decline(token); }
}

/** Owner console: posts for the public site, written and illustrated from the dashboard. */
@Controller('platform/posts')
export class PostsAdminController {
  constructor(private readonly posts: PostsService) {}

  @PlatformOnly() @Get() list() { return this.posts.list(); }
  @PlatformOnly() @Post() create(@CurrentAuth() a: PlatformAuth, @Body() dto: PostDto) { return this.posts.create(dto, a.adminId); }
  @PlatformOnly() @Put(':id') update(@Param('id', Id()) id: string, @Body() dto: PostDto) { return this.posts.update(id, dto); }
  @PlatformOnly() @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) async remove(@Param('id', Id()) id: string): Promise<void> { await this.posts.remove(id); }

  @PlatformOnly() @Post(':id/images')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 9 * 1024 * 1024, files: 1 } }))
  addImage(@Param('id', Id()) id: string, @Body() dto: ImageCaptionDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach the photo in the "file" field');
    return this.posts.addImage(id, file, dto.caption);
  }

  @PlatformOnly() @Delete('images/:imageId') @HttpCode(HttpStatus.NO_CONTENT)
  async removeImage(@Param('imageId', Id()) imageId: string): Promise<void> { await this.posts.removeImage(imageId); }
}

@Public()
@Controller('public/posts')
export class PostsPublicController {
  constructor(private readonly posts: PostsService) {}

  @Get() list(@Query('limit', new DefaultValuePipe(12), ParseIntPipe) limit: number) { return this.posts.publicList(limit); }

  @Get('image/:id')
  async image(@Param('id', Id()) id: string, @Res({ passthrough: true }) res: Response) {
    const { mimeType, stream } = await this.posts.openImage(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }
}
