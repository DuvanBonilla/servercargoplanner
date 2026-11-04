import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Put,
  Param,
  Delete,
  UsePipes,
  NotFoundException,
  UseGuards,
  Query,
  Res,
  UseInterceptors,
  ConflictException,
  InternalServerErrorException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  UploadedFile,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { extname } from 'path';
import { PreviewInabilityDto, RegisterInabilityDto, SaveCertificateDraftDto } from './dto/register-inability.dto';
import {
  InabilityRegistrationService,
  isRegistrationError,
} from './service/inability-registration.service';
import { InabilityPreviewEntity, InabilityRegisteredEntity } from './entities/inability-registration.entity';
import { CreateInabilityFollowUpDto, UpdateInabilityDetailsDto } from './dto/inability-tracking.dto';
import { InabilityTrackingService } from './service/inability-tracking.service';

const CERTIFICATE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.webp': 'image/webp',
};
import { FileInterceptor } from '@nestjs/platform-express';
import { InabilityService } from './inability.service';
import { CreateInabilityDto } from './dto/create-inability.dto';
import { UpdateInabilityDto } from './dto/update-inability.dto';
import { DateTransformPipe } from 'src/pipes/date-transform/date-transform.pipe';
import { ParseIntPipe } from 'src/pipes/parse-int/parse-int.pipe';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiQuery, ApiParam, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FilterInabilityDto } from './dto/filter-inability';
import { Response } from 'express';
// import { ExcelExportService } from 'src/common/validation/services/excel-export.service';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { SiteInterceptor } from 'src/common/interceptors/site.interceptor';
import { UpdateInabilityService } from './service/update-inability.service';
import {
  CertificateExtractionService,
  type UploadedCertificate,
} from './service/certificate-extraction.service';
import { CertificateExtractionEntity } from './entities/certificate-extraction.entity';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('inability')
@UseGuards(JwtAuthGuard)
@UseInterceptors(SiteInterceptor)
@ApiBearerAuth('access-token')
export class InabilityController {
  constructor(
    private readonly inabilityService: InabilityService,
    // private readonly excelExportService: ExcelExportService,
    private readonly updateInabilityService: UpdateInabilityService,
    private readonly certificateExtractionService: CertificateExtractionService,
    private readonly inabilityRegistrationService: InabilityRegistrationService,
    private readonly inabilityTrackingService: InabilityTrackingService,
  ) {}

  @Get('tracking')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability tracking')
  @ApiOperation({
    summary: 'List inabilities with recovery tracking',
    description:
      'Inabilities of the site with their certificate data, who pays, deadlines, recovery status, current filing number, amounts paid and follow-up history. ' +
      'Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiResponse({ status: 200, description: 'Inabilities, most recent first' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  async tracking(@CurrentUser('siteId') siteId: number, @CurrentUser('subsiteId') subsiteId: number) {
    return this.throwIfError(await this.inabilityTrackingService.list(siteId, subsiteId));
  }

  @Get(':id/tracking')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability tracking')
  @ApiOperation({ summary: 'Get inability tracking', description: 'One inability with its recovery tracking and history. Roles: SUPERADMIN, ADMIN, GH.' })
  @ApiResponse({ status: 200, description: 'Inability with its tracking' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Inability not found' })
  async trackingOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.throwIfError(await this.inabilityTrackingService.findOne(id, siteId, role));
  }

  @Post(':id/follow-ups')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability tracking')
  @ApiOperation({
    summary: 'Add inability follow-up',
    description:
      'Records a filing, PQR, payment, rejection or note and updates the recovery status: FILING = FILED, PQR = IN_RECOVERY, REJECTION = REJECTED, ' +
      'PAYMENT = PAID when the paid days cover the days owed by the entity (and the approved amount, if known), otherwise PARTIALLY_PAID; ' +
      'NOTE = optional status change. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiResponse({ status: 201, description: 'Inability with its updated tracking' })
  @ApiResponse({ status: 400, description: 'Invalid data or required field missing for the type' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Inability not found' })
  async addFollowUp(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateInabilityFollowUpDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.throwIfError(await this.inabilityTrackingService.addFollowUp(id, dto, userId, siteId, role));
  }

  @Delete(':id/follow-ups/:followUpId')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability tracking')
  @ApiOperation({
    summary: 'Delete latest inability follow-up',
    description: 'Corrects a typing error: only the latest event can be deleted, the status returns to the previous one and the deletion stays in the history. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiResponse({ status: 200, description: 'Inability with its updated tracking' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Inability or follow-up not found' })
  @ApiResponse({ status: 409, description: 'It is not the latest follow-up' })
  async removeFollowUp(
    @Param('id', ParseIntPipe) id: number,
    @Param('followUpId', ParseIntPipe) followUpId: number,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.throwIfError(await this.inabilityTrackingService.removeFollowUp(id, followUpId, userId, siteId, role));
  }

  @Patch(':id/details')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability tracking')
  @ApiOperation({
    summary: 'Edit inability details',
    description:
      'Edits the data of an inability, or completes an old one, and recalculates who pays and the deadlines. The changed fields stay in the history. ' +
      'Dates, origin and classification cannot change if extensions were registered after it. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiResponse({ status: 200, description: 'Inability updated with its new calculation' })
  @ApiResponse({ status: 400, description: 'Invalid data, IBC below the minimum wage or minimum wage not configured' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed or worker of another site' })
  @ApiResponse({ status: 404, description: 'Inability or EPS not found' })
  @ApiResponse({ status: 409, description: 'OVERLAP, DUPLICATE_CERTIFICATE or HAS_EXTENSIONS' })
  async updateDetails(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInabilityDetailsDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.throwIfError(await this.inabilityRegistrationService.updateDetails(id, dto, userId, siteId, role));
  }

  @Post(':id/certificate')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability tracking')
  @ApiOperation({
    summary: 'Upload inability certificate',
    description: 'Uploads or replaces the certificate file without reading it with the AI. Replacing deletes the previous file. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary', description: 'Certificate PDF or image (max 15 MB)' } },
    },
  })
  @ApiResponse({ status: 201, description: 'Inability with its updated tracking' })
  @ApiResponse({ status: 400, description: 'Missing file' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Inability not found' })
  @ApiResponse({ status: 413, description: 'File exceeds 15 MB' })
  @ApiResponse({ status: 415, description: 'Unsupported file type' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async uploadCertificate(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedCertificate | undefined,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.throwIfError(await this.inabilityTrackingService.replaceCertificate(id, file, userId, siteId, role));
  }

  @Post('certificate/extract')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability certificate')
  @ApiOperation({
    summary: 'Extract inability certificate',
    description:
      'Reads an inability certificate (PDF downloaded from the EPS/ARL portal or scanned image) and returns its fields to pre-fill the registration. ' +
      'Digital PDFs are read from their text layer (free). Scans are read with the OpenAI vision model, sending only the certificate page ' +
      '(medical history pages are skipped); if the AI is unavailable, local OCR is used. The AI usage (tokens and cost) is logged (see /ai-usage). ' +
      'With id_worker, the document number is checked against the selected worker and the employer NIT against the company of the current contract. ' +
      'No inability is created: the file and the reading are kept for 7 days so the registration can be resumed without reading it again. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Certificate PDF or image (max 15 MB)' },
        id_worker: { type: 'integer', example: 479, description: 'Selected worker (recommended)' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Fields read from the certificate', type: CertificateExtractionEntity })
  @ApiResponse({ status: 400, description: 'Missing file or invalid id_worker' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed or worker belongs to another site' })
  @ApiResponse({ status: 404, description: 'Worker not found' })
  @ApiResponse({ status: 413, description: 'File exceeds 15 MB' })
  @ApiResponse({ status: 415, description: 'Unsupported file type' })
  @ApiResponse({ status: 422, description: 'The document could not be read' })
  @ApiResponse({ status: 503, description: 'Extraction service unavailable' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async extractCertificate(
    @UploadedFile() file: UploadedCertificate | undefined,
    @Body('id_worker') idWorker: string | undefined,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    if (!file) throw new BadRequestException('file is required');
    const id_worker = idWorker === undefined || idWorker === '' ? undefined : Number(idWorker);
    if (id_worker !== undefined && !Number.isInteger(id_worker)) {
      throw new BadRequestException('id_worker must be an integer');
    }
    const response: any = await this.certificateExtractionService.extract(file, userId, id_worker, siteId, role);
    if (typeof response?.status === 'number' && response.message) {
      if (response.status === 404) throw new NotFoundException(response.message);
      if (response.status === 403) throw new ForbiddenException(response.message);
      throw new HttpException(response.message, response.status);
    }
    return response;
  }

  @Post('certificate/manual')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability certificate')
  @ApiOperation({
    summary: 'Attach certificate without reading it',
    description:
      'Stores the certificate without calling the extractor, for when the reading service is unavailable or the document cannot be read. ' +
      'Returns the same structure as POST /inability/certificate/extract with no fields read (format MANUAL): the user enters every field and, ' +
      'when registering, must confirm the certificate belongs to the worker (documentConfirmed). Kept for 7 days. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'id_worker'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Certificate PDF or image (max 15 MB)' },
        id_worker: { type: 'integer', example: 479 },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Certificate stored without reading', type: CertificateExtractionEntity })
  @ApiResponse({ status: 400, description: 'Missing file or invalid id_worker' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed or worker belongs to another site' })
  @ApiResponse({ status: 404, description: 'Worker not found' })
  @ApiResponse({ status: 413, description: 'File exceeds 15 MB' })
  @ApiResponse({ status: 415, description: 'Unsupported file type' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async attachCertificateManual(
    @UploadedFile() file: UploadedCertificate | undefined,
    @Body('id_worker') idWorker: string | undefined,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    if (!file) throw new BadRequestException('file is required');
    const id_worker = Number(idWorker);
    if (!idWorker || !Number.isInteger(id_worker)) throw new BadRequestException('id_worker must be an integer');
    return this.throwIfError(await this.certificateExtractionService.attachManual(file, userId, id_worker, siteId, role));
  }

  @Get('certificate/drafts')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability certificate')
  @ApiOperation({
    summary: 'List certificate drafts',
    description:
      'Certificates read by the current user for the worker and not registered yet, with the reading and the form as it was left. ' +
      'Resuming a draft does not call the AI again. Drafts expire 7 days after the reading. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiQuery({ name: 'id_worker', required: true, type: Number, example: 479 })
  @ApiResponse({ status: 200, description: 'Drafts, most recent first' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed or worker belongs to another site' })
  @ApiResponse({ status: 404, description: 'Worker not found' })
  async listCertificateDrafts(
    @Query('id_worker', ParseIntPipe) idWorker: number,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.throwIfError(await this.certificateExtractionService.listDrafts(idWorker, userId, siteId, role));
  }

  @Put('certificate/drafts/:token')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability certificate')
  @ApiOperation({
    summary: 'Save certificate draft',
    description: 'Stores the registration form as the user left it. It does not extend the 7 days of the reading. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiResponse({ status: 200, description: 'Draft saved' })
  @ApiResponse({ status: 400, description: 'Invalid data' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed or certificate read by another user' })
  @ApiResponse({ status: 404, description: 'Certificate upload not found (expired)' })
  async saveCertificateDraft(
    @Param('token') token: string,
    @Body() dto: SaveCertificateDraftDto,
    @CurrentUser('userId') userId: number,
  ) {
    return this.throwIfError(await this.certificateExtractionService.saveDraft(token, { form: dto.form, selectedWorkerId: dto.selectedWorkerId }, userId));
  }

  @Get('certificate/drafts/:token/file')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability certificate')
  @ApiOperation({ summary: 'Download certificate draft file', description: 'Returns the uploaded file of a draft. Roles: SUPERADMIN, ADMIN, GH.' })
  @ApiResponse({ status: 200, description: 'Certificate file' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed or certificate read by another user' })
  @ApiResponse({ status: 404, description: 'Certificate upload not found (expired)' })
  async certificateDraftFile(@Param('token') token: string, @CurrentUser('userId') userId: number) {
    const file = this.throwIfError(await this.certificateExtractionService.draftFile(token, userId));
    return new StreamableFile(createReadStream(file.path), {
      type: file.mimetype,
      disposition: `inline; filename="${encodeURIComponent(file.name)}"`,
    });
  }

  @Delete('certificate/drafts/:token')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability certificate')
  @ApiOperation({ summary: 'Discard certificate draft', description: 'Deletes the uploaded file, the reading and the form. Roles: SUPERADMIN, ADMIN, GH.' })
  @ApiResponse({ status: 200, description: 'Draft discarded' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed or certificate read by another user' })
  @ApiResponse({ status: 404, description: 'Certificate upload not found (expired)' })
  async discardCertificateDraft(@Param('token') token: string, @CurrentUser('userId') userId: number) {
    return this.throwIfError(await this.certificateExtractionService.discardDraft(token, userId));
  }

  @Post('register/preview')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability registration')
  @ApiOperation({
    summary: 'Preview inability registration',
    description:
      'Calculates, without saving, what the registration will store: contract and company on the start date, days of contract (28-day rule), ' +
      'INITIAL/EXTENSION suggested from the worker history, extension chain, who pays each day (company, EPS/ARL, pension fund), ' +
      'filing and recovery deadlines and the minimum IBC. Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiResponse({ status: 201, description: 'Calculation', type: InabilityPreviewEntity })
  @ApiResponse({ status: 400, description: 'Invalid data, invalid extension or IBC below the minimum wage' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed or worker belongs to another site' })
  @ApiResponse({ status: 404, description: 'Worker not found' })
  async previewRegistration(
    @Body() dto: PreviewInabilityDto,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.throwIfError(await this.inabilityRegistrationService.preview(dto, siteId, role));
  }

  @Post('register')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability registration')
  @ApiOperation({
    summary: 'Register inability from certificate',
    description:
      'Registers the inability confirmed by the user, using the fileToken of POST /inability/certificate/extract. ' +
      'Rejected when the document number read from the certificate does not match the worker (409 WORKER_MISMATCH), when the dates overlap ' +
      'another inability (409 OVERLAP), when the certificate is already registered (409 DUPLICATE_CERTIFICATE) or when the IBC is below the ' +
      'minimum wage of the start year. Stores the certificate file and a copy of contract, company, EPS, ARL, IBC and the payment days. ' +
      'Roles: SUPERADMIN, ADMIN, GH.',
  })
  @ApiResponse({ status: 201, description: 'Inability registered', type: InabilityRegisteredEntity })
  @ApiResponse({ status: 400, description: 'Invalid data, document not confirmed, IBC below the minimum wage or minimum wage not configured' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed, worker of another site or certificate read by another user' })
  @ApiResponse({ status: 404, description: 'Worker, EPS or certificate upload not found (expired)' })
  @ApiResponse({ status: 409, description: 'WORKER_MISMATCH, OVERLAP or DUPLICATE_CERTIFICATE' })
  async register(
    @Body() dto: RegisterInabilityDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    return this.throwIfError(await this.inabilityRegistrationService.register(dto, userId, siteId, role));
  }

  @Get(':id/certificate')
  @UseGuards(RolesGuard)
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.GH)
  @ApiTags('Inability registration')
  @ApiOperation({ summary: 'Download inability certificate', description: 'Returns the certificate file stored with the inability. Roles: SUPERADMIN, ADMIN, GH.' })
  @ApiResponse({ status: 200, description: 'Certificate file' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'User role is not allowed' })
  @ApiResponse({ status: 404, description: 'Inability not found or without certificate' })
  async certificate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    const file = this.throwIfError(await this.inabilityRegistrationService.certificateFile(id, siteId, role));
    const ext = extname(file.path).toLowerCase();
    return new StreamableFile(createReadStream(file.path), {
      type: CERTIFICATE_TYPES[ext] ?? 'application/octet-stream',
      disposition: `inline; filename="${encodeURIComponent(file.name)}"`,
    });
  }

  /** Errores del servicio ({status, message, details}) como respuestas HTTP reales */
  private throwIfError<T>(response: T): Exclude<T, { status: number; message: string; details?: unknown }> {
    if (isRegistrationError(response)) {
      const { status, message, details } = response as any;
      throw new HttpException({ statusCode: status, message, ...(details ?? {}) }, status);
    }
    return response as any;
  }

  @Post()
  async create(
    @Body() createInabilityDto: CreateInabilityDto,
    @CurrentUser('userId') userId: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    createInabilityDto.id_user = userId;
    const response = await this.inabilityService.create(
      createInabilityDto,
      siteId,
      role,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Get()
  async findAll(
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
    @CurrentUser('subsiteId') subsiteId: number,
  ) {
    const response = await this.inabilityService.findAll(siteId, role, subsiteId);
    if (response && response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response && response['status'] === 409) {
      throw new ConflictException(response['message']);
    } else if (response && response['status'] === 500) {
      throw new InternalServerErrorException(response['message']);
    }
    return response;
  }

  @Get('search/dni/:dni')
  @ApiParam({
    name: 'dni',
    required: true,
    description: 'DNI del trabajador para buscar sus incapacidades',
    example: '12345678'
  })
  async findByDni(
    @Param('dni') dni: string,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    const response = await this.inabilityService.findByDni(dni, siteId, role);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }
  
  @Get('search/filters')
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'excel', 'base64'],
    description:
      'Formato de respuesta: json por defecto o excel para exportación',
  })
  async findByFilters(
    @Query(DateTransformPipe) filters: FilterInabilityDto,
    @Query('format') format: string = 'json',
    @Res({ passthrough: true }) res: Response,
    @CurrentUser('siteId') siteId: number,
  ) {
    if (siteId) {
      filters.id_site = siteId;
    }
    const response = await this.inabilityService.findByFilters(filters);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    if (!Array.isArray(response)) {
      return response;
    }
    // if (format === 'excel') {
    //   return this.excelExportService.exportToExcel(
    //     res,
    //     response,
    //     'incapacidades',
    //     'Reporte de Incapacidades',
    //     'binary',
    //   );
    // }

    // if (format === 'base64') {
    //   return this.excelExportService.exportToExcel(
    //     null,
    //     response,
    //     'incapacidades',
    //     'Reporte de Incapacidades',
    //     'base64',
    //   );
    // }
    return response;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    const response = await this.inabilityService.findOne(id, siteId, role);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }
    return response;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateInabilityDto: UpdateInabilityDto,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    const response = await this.inabilityService.update(
      id,
      updateInabilityDto,
      siteId,
      role,
    );
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    } else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('siteId') siteId: number,
    @CurrentUser('role') role: string,
  ) {
    const response = await this.inabilityService.remove(id, siteId, role);
    if (response['status'] === 404) {
      throw new NotFoundException(response['message']);
    }else if (response['status'] === 409) {
      throw new ConflictException(response['message']);
    }
    return response;
  }

  @Post('admin/test-update-expired')
  async testUpdateExpiredInabilities() {
    return await this.updateInabilityService.updateWorkersWithExpiredInabilities();
  }
}

