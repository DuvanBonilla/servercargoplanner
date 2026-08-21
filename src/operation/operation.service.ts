import {
  BadRequestException,
  ConflictException, HttpException, HttpStatus,
  Injectable, Logger, NotFoundException
} from '@nestjs/common';
import { CreateOperationDto } from './dto/create-operation.dto';
import { UpdateOperationDto } from './dto/update-operation.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { OperationWorkerService } from 'src/operation-worker/operation-worker.service';
// import { BillService } from 'src/bill/bill.service';
import { BillStatus, Role, StatusActivation, StatusComplete, StatusOperation, TokenStatus, YES_NO } from '@prisma/client';
import { OperationFinderService } from './services/operation-finder.service';
import { OperationRelationService } from './services/operation-relation.service';
import { OperationFilterDto } from './dto/fliter-operation.dto';
import { WorkerService } from 'src/worker/worker.service';
import { RemoveWorkerFromOperationService } from '../operation-worker/service/remove-worker-from-operation/remove-worker-from-operation.service';
import { ModuleRef } from '@nestjs/core';
import { getWeekNumber, getStartOfWeek, toLocalDate, isHoliday } from 'src/common/utils/dateType';
import { OperationNotFoundException } from './exceptions/operation-not-found.exception';
import { TokenGenerationFailedException } from './exceptions/token-generation-failed.exception';
import { formatColombianDate, getColombianDateTime } from 'src/common/utils/dateColombia';
import { OperationTokenService } from './services/operation-token.service';
import { OperationEmailService } from './services/operation-email.service';
import { ConfigurationService } from 'src/configuration/configuration.service';
// ... otras importaciones
/**
 * Servicio para gestionar operaciones
 * @class OperationService
 */
@Injectable()
export class OperationService {
  private readonly logger = new Logger(OperationService.name);
  // Duración del token en minutos
  private static readonly TOKEN_VALIDITY_MINUTES = 15;
  constructor(
    private prisma: PrismaService,
    private operationWorkerService: OperationWorkerService,
    private finderService: OperationFinderService,
    private relationService: OperationRelationService,
    private workerService: WorkerService,
    private removeWorkerService: RemoveWorkerFromOperationService,
    private moduleRef: ModuleRef,
    private operationTokenService: OperationTokenService,
    private operationEmailService: OperationEmailService,
    private configurationService: ConfigurationService,
    // private billService: BillService,
  ) { }
  /**
   * Obtiene todas las operaciones
   * @returns Lista de operaciones con relaciones incluidas
   */
  async findAll(id_site?: number, id_subsite?: number) {
    return await this.finderService.findAll(id_site, id_subsite);
  }
  /**
   * Busca una operación por su ID
   * @param id - ID de la operación a buscar
   * @returns Operación encontrada o mensaje de error
   */
  async findOne(id: number, id_site?: number, id_subsite?: number) {
    return await this.finderService.findOne(id, id_site, id_subsite);
  }
  /**
   * Obtiene una operación con detalles de tarifas
   * @param operationId - ID de la operación a buscar
   * @returns Operación con detalles de tarifas o mensaje de error
   */
  async getOperationWithDetailedTariffs(operationId: number) {
    return await this.finderService.getOperationWithDetailedTariffs(
      operationId,
    );
  }
  /**
   * Encuentra todas las operaciones activas (IN_PROGRESS y PENDING) sin filtros de fecha
   * @returns Lista de operaciones activas o mensaje de error
   */
  async findActiveOperations(
    statuses: StatusOperation[],
    id_site?: number,
    id_subsite?: number,
  ) {
    return await this.finderService.findByStatuses(
      statuses,
      id_site,
      id_subsite,
    );
  }
  /**
   *  Busca operaciones por rango de fechas
   * @param start Fecha de inicio
   * @param end Fecha de fin
   * @returns resultado de la busqueda
   */
  async findOperationRangeDate(
    start: Date,
    end: Date,
    id_site?: number,
    id_subsite?: number,
  ) {
    return await this.finderService.findByDateRange(
      start,
      end,
      id_site,
      id_subsite,
    );
  }
  /**
   * Encuentra operaciones asociadas a un usuario específico
   * @param id_user ID del usuario para buscar operaciones
   * @returns  Lista de operaciones asociadas al usuario o mensaje de error
   */
  async findOperationByUser(
    id_user: number,
    id_site?: number,
    id_subsite?: number,
  ) {
    return await this.finderService.findByUser(id_user, id_site, id_subsite);
  }

  /**
  * Obtener operaciones con paginación y filtros opcionales
  */
  async findAllPaginated(
    page: number = 1,
    limit: number = 10,
    filters?: OperationFilterDto,
    activatePaginated: boolean = true,
  ) {
    return this.finderService.findAllPaginated(
      page,
      limit,
      filters,
      activatePaginated,
    );
  }

  /**
   * Determina si una subtarea es especial.
   * Se considera especial si tiene al menos una tarifa con isSpecial = YES.
   */

  // Determina si la operación tiene alguna tarifa especial (Tariff.isSpecial = YES).
  async isOperationSpecial(
    operationId: number,
    operation?: { id: number } | null,
  ): Promise<boolean> {
    if (!operationId || operationId <= 0) {
      throw new BadRequestException('operationId inválido');
    }

    const operationExists =
      operation ||
      (await this.prisma.operation.findUnique({
        where: { id: operationId },
        select: { id: true },
      }));

    if (!operationExists) {
      throw new OperationNotFoundException(operationId);
    }

    const specialTariffCount = await this.prisma.operation_Worker.count({
      where: {
        id_operation: operationId,
        tariff: {
          isSpecial: YES_NO.YES,
        },
      },
    });

    return specialTariffCount > 0;
  }

  /**
   * Completar una operación según si es especial o no.
   * - No especial: COMPLETED
   * - Especial: TO_APPROVED + creación de confirmación
   */
  // async completeOperation(operationId: number) {
  //   if (!operationId || operationId <= 0) {
  //     throw new BadRequestException('operationId inválido');
  //   }

  //   const operation = await this.prisma.operation.findUnique({
  //     where: { id: operationId },
  //     select: { id: true, status: true, id_user: true },
  //   });

  //   if (!operation) {
  //     throw new OperationNotFoundException(operationId);
  //   }

  //   const isSpecial = await this.isOperationSpecial(operationId, operation);

  //   if (!isSpecial) {
  //     const now = getColombianDateTime();
  //     const [hh, mm] = getColombianTimeString().split(':');

  //     const updatedOperation = await this.prisma.operation.update({
  //       where: { id: operationId },
  //       data: {
  //         status: StatusOperation.COMPLETED,
  //         dateEnd: now,
  //         timeEnd: `${hh}:${mm}`,
  //       },
  //     });

  //     await this.operationWorkerService.completeClientProgramming(operationId);
  //     await this.operationWorkerService.releaseAllWorkersFromOperation(
  //       operationId,
  //     );
  //     await this.workerService.addWorkedHoursOnOperationEnd(operationId);

  //     this.logger.log(
  //       `Operacion ${operationId} completada en estado ${StatusOperation.COMPLETED}`,
  //     );

  //     return {
  //       operation: updatedOperation,
  //       isSpecial: false,
  //       movedTo: StatusOperation.COMPLETED,
  //     };
  //   }

  //   const allGroupsCompleted =
  //     await this.operationWorkerService.hasAllGroupsCompleted(operationId);

  //   if (!allGroupsCompleted) {
  //     throw new ConflictException(
  //       'No se puede completar la operacion especial: todos los grupos deben tener fecha y hora de finalizacion',
  //     );
  //   }

  //   await this.ensurePreBillsForSpecialOperation(
  //     operationId,
  //     operation.id_user ?? 1,
  //   );

  //   const updatedOperation = await this.prisma.operation.update({
  //     where: { id: operationId },
  //     data: { status: StatusOperation.TO_APPROVED },
  //   });

  //   const confirmationData = await this.createConfirmation(
  //     operationId,
  //     operation,
  //   );
  //   const tokenTtlMinutes = this.getTokenValidityMinutes();
  //   const emailTarget = await this.resolveClientConfirmationEmail(operationId);

  //   let emailNotification: {
  //     sent: boolean;
  //     to: string | null;
  //     reason?: string;
  //     messageId?: string;
  //   } = {
  //     sent: false,
  //     to: emailTarget,
  //   };

  //   if (emailTarget) {
  //     const emailResult =
  //       await this.operationEmailService.sendSpecialOperationConfirmationEmail({
  //         to: emailTarget,
  //         operationId,
  //         confirmationLink: confirmationData.link,
  //         tokenTtlMinutes,
  //       });

  //     emailNotification = {
  //       sent: emailResult.sent,
  //       to: emailTarget,
  //       reason: emailResult.reason,
  //       messageId: emailResult.messageId,
  //     };
  //   } else {
  //     emailNotification = {
  //       sent: false,
  //       to: null,
  //       reason:
  //         'No se encontro correo valido del cliente. Configure CONFIRMATION_DEFAULT_EMAIL o ajuste datos del cliente.',
  //     };
  //     this.logger.warn(
  //       `Operacion ${operationId} no tiene correo destino valido para enviar confirmacion`,
  //     );
  //   }

  //   this.logger.log(
  //     `Operacion ${operationId} movida a ${StatusOperation.TO_APPROVED} y confirmacion ${confirmationData.confirmation.id} creada/reutilizada`,
  //   );

  //   return {
  //     operation: updatedOperation,
  //     confirmation: confirmationData.confirmation,
  //     token: confirmationData.token,
  //     link: confirmationData.link,
  //     emailNotification,
  //     isSpecial: true,
  //     movedTo: StatusOperation.TO_APPROVED,
  //   };
  // }

  //Crea o reutiliza la confirmación de una operación especial y genera token.
  async createConfirmation(
    operationId: number,
    operation?: { id: number } | null,
  ) {
    if (!operationId || operationId <= 0) {
      throw new BadRequestException('operationId inválido');
    }

    const operationExists =
      operation ||
      (await this.prisma.operation.findUnique({
        where: { id: operationId },
        select: { id: true },
      }));

    if (!operationExists) {
      throw new OperationNotFoundException(operationId);
    }

    const isSpecial = await this.isOperationSpecial(
      operationId,
      operationExists,
    );
    if (!isSpecial) {
      throw new ConflictException(
        'La operación no es especial y no requiere confirmación',
      );
    }

    const confirmation = await this.prisma.operationConfirmation.upsert({
      where: { id_operation: operationId },
      update: {},
      create: { id_operation: operationId },
    });

    this.logger.log(
      `Confirmacion ${confirmation.id} creada/reutilizada para operacion ${operationId}`,
    );

    // Si ya existe un token activo, se expira para garantizar que el link nuevo sea el único válido.
    const activeToken = await this.prisma.token.findFirst({
      where: {
        id_confirmation: confirmation.id,
        status: TokenStatus.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tokenHash: true,
        createdAt: true,
        status: true,
      },
    });

    if (activeToken) {
      await this.prisma.token.update({
        where: { id: activeToken.id },
        data: { status: TokenStatus.EXPIRED },
      });

      this.logger.log(
        `Token activo ${activeToken.id} expirado para emitir uno nuevo (confirmacion ${confirmation.id}, operacion ${operationId})`,
      );
    }

    // createdToken guarda metadatos persistidos; rawTokenValue es solo para responder el link.
    let createdToken: {
      id: number;
      tokenHash: string;
      createdAt: Date;
      status: TokenStatus;
    } | null = null;
    let rawTokenValue: string | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const tokenValue = this.operationTokenService.generateTokenValue();
      // Hash determinístico para búsqueda segura sin exponer token plano en BD.
      const tokenHash = this.operationTokenService.hashTokenValue(tokenValue);

      try {
        createdToken = await this.prisma.token.create({
          data: {
            id_confirmation: confirmation.id,
            tokenHash,
            status: TokenStatus.ACTIVE,
          },
          select: {
            id: true,
            tokenHash: true,
            createdAt: true,
            status: true,
          },
        });
        rawTokenValue = tokenValue;
        break;
      } catch (error: any) {
        const isUniqueTokenError = error?.code === 'P2002';
        if (!isUniqueTokenError) {
          this.logger.error(
            `Error persistiendo token para operacion ${operationId}: ${error?.message || 'unknown error'} (code: ${error?.code || 'N/A'})`,
          );
          throw new TokenGenerationFailedException(
            operationId,
            `Error de base de datos al persistir token: ${error?.message || 'unknown error'}`,
          );
        }

        if (attempt === 4) {
          throw new TokenGenerationFailedException(
            operationId,
            'No se pudo persistir un token unico para la confirmacion tras multiples reintentos',
          );
        }
      }
    }

    if (!createdToken) {
      throw new TokenGenerationFailedException(
        operationId,
        'No se pudo generar token de confirmacion',
      );
    }

    // Defensa adicional: si por alguna razón no existe token plano, no devolvemos link inválido.
    if (!rawTokenValue) {
      throw new TokenGenerationFailedException(
        operationId,
        'No se pudo recuperar el token de confirmacion generado',
      );
    }

    this.logger.log(
      `Token ${createdToken.id} creado para confirmacion ${confirmation.id} (operacion ${operationId})`,
    );

    const link =
      this.operationTokenService.buildConfirmationLink(rawTokenValue);

    this.logger.warn(
      `LINK_CONFIRMACION_PORTAL operacion=${operationId} confirmation=${confirmation.id} link=${link}`,
    );

    return {
      operationId,
      confirmation,
      token: createdToken,
      link,
    };
  }

  /**
   * Obtiene el link de confirmación para una operación especial
   * Si no existe confirmación aún, la crea
   */
  async getConfirmationLinkForSpecialOperation(operationId: number) {
    if (!operationId || operationId <= 0) {
      throw new BadRequestException('operationId inválido');
    }

    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: { id: true, status: true, id_user: true },
    });

    if (!operation) {
      throw new OperationNotFoundException(operationId);
    }

    const isSpecial = await this.isOperationSpecial(operationId, operation);

    if (!isSpecial) {
      throw new ConflictException(
        'La operación no es especial y no tiene link de confirmación',
      );
    }

    if (operation.status !== StatusOperation.TO_APPROVED) {
      throw new ConflictException(
        `La operación no está en estado TO_APPROVED (estado actual: ${operation.status}). No tiene link de confirmación.`,
      );
    }

    await this.ensurePreBillsForSpecialOperation(
      operationId,
      operation.id_user ?? 1,
    );

    // Obtener o crear la confirmación
    const confirmationData = await this.createConfirmation(
      operationId,
      operation,
    );

    const tokenCreatedAt = confirmationData.token.createdAt;
    const tokenExpiresAt = this.getTokenExpiresAt(tokenCreatedAt);
    const remainingSeconds = Math.max(
      0,
      Math.floor((tokenExpiresAt.getTime() - Date.now()) / 1000),
    );

    return {
      operationId,
      link: confirmationData.link,
      status: operation.status,
      tokenCreatedAt,
      tokenExpiresAt,
      remainingSeconds,
      tokenStatus: confirmationData.token.status,
    };
  }

  /**
   * Reenvía una operación especial RECHAZADA de vuelta a TO_APPROVED.
   * Invalida los tokens anteriores, genera uno nuevo y reenvía el correo al cliente.
   * Sólo aplica a operaciones especiales (isSpecial = YES) en estado REJECTED.
   */
  async resubmitRejectedOperation(operationId: number, supervisorObservation?: string | null) {
    if (!operationId || operationId <= 0) {
      throw new BadRequestException('operationId inválido');
    }

    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: { id: true, status: true, id_user: true },
    });

    if (!operation) {
      throw new OperationNotFoundException(operationId);
    }

    if (operation.status !== StatusOperation.REJECTED) {
      throw new ConflictException(
        `La operación ${operationId} no está en estado REJECTED (estado actual: ${operation.status})`,
      );
    }

    const isSpecial = await this.isOperationSpecial(operationId, operation);
    if (!isSpecial) {
      throw new ConflictException(
        `La operación ${operationId} no es especial y no puede ser reenviada a aprobación por este flujo`,
      );
    }

    // Expirar todos los tokens activos de la confirmación anterior
    const existingConfirmation = await this.prisma.operationConfirmation.findUnique({
      where: { id_operation: operationId },
      select: { id: true },
    });

    if (existingConfirmation) {
      await this.prisma.token.updateMany({
        where: {
          id_confirmation: existingConfirmation.id,
          status: TokenStatus.ACTIVE,
        },
        data: { status: TokenStatus.EXPIRED },
      });
      this.logger.log(
        `Tokens anteriores expirados para confirmación ${existingConfirmation.id} (operación ${operationId})`,
      );
    }

    // Cambiar estado a TO_APPROVED
    const updatedOperation = await this.prisma.operation.update({
      where: { id: operationId },
      data: { status: StatusOperation.TO_APPROVED },
    });

    // Crear / reutilizar confirmación y generar nuevo token
    const confirmationData = await this.createConfirmation(operationId, operation);

    // Guardar nota interna del supervisor si se proporcionó
    if (supervisorObservation?.trim()) {
      await this.prisma.operationConfirmation.update({
        where: { id: confirmationData.confirmation.id },
        data: { supervisorObservation: supervisorObservation.trim() },
      });
    }

    const tokenTtlMinutes = this.getTokenValidityMinutes();
    const emailTarget = await this.resolveClientConfirmationEmail(operationId);

    let emailNotification: {
      sent: boolean;
      to: string | null;
      reason?: string;
      messageId?: string;
    } = { sent: false, to: emailTarget };

    if (emailTarget) {
      const serviceLabel = await this.servicesForSendByEmail(operationId);
      const serviceCode = await this.getClientServiceCode(operationId);
      const emailResult =
        await this.operationEmailService.sendSpecialOperationConfirmationEmail({
          to: emailTarget,
          operationId,
          confirmationLink: confirmationData.link,
          tokenTtlMinutes,
          serviceLabel,
          serviceCode,
        });
      emailNotification = {
        sent: emailResult.sent,
        to: emailTarget,
        reason: emailResult.reason,
        messageId: emailResult.messageId,
      };
    } else {
      emailNotification = {
        sent: false,
        to: null,
        reason:
          'No se encontró correo válido del cliente. Configure CONFIRMATION_DEFAULT_EMAIL o ajuste datos del cliente.',
      };
      this.logger.warn(
        `Operación ${operationId} reenviada a aprobación sin correo destino válido`,
      );
    }

    this.logger.log(
      `Operación ${operationId} reenviada de REJECTED a TO_APPROVED. Confirmación: ${confirmationData.confirmation.id}`,
    );

    return {
      operation: updatedOperation,
      confirmation: confirmationData.confirmation,
      token: confirmationData.token,
      link: confirmationData.link,
      emailNotification,
      movedTo: StatusOperation.TO_APPROVED,
    };
  }

  /**
   * Envía el correo de confirmación de una operación especial a un destinatario
   * escrito manualmente (por ahora no se obtiene de la base de datos).
   * Reutiliza el token activo (mismo enlace que el QR) y NO envía QR, solo el link.
   */
  async sendConfirmationEmailManually(
    operationId: number,
    params: { to: string; subject?: string; body?: string },
  ) {
    if (!operationId || operationId <= 0) {
      throw new BadRequestException('operationId inválido');
    }

    const to = (params?.to || '').trim();
    if (!this.isValidEmail(to)) {
      throw new BadRequestException(
        'Debe proporcionar un correo destino válido',
      );
    }

    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: { id: true, status: true, id_user: true },
    });

    if (!operation) {
      throw new OperationNotFoundException(operationId);
    }

    const isSpecial = await this.isOperationSpecial(operationId, operation);
    if (!isSpecial) {
      throw new ConflictException(
        'La operación no es especial y no tiene enlace de confirmación',
      );
    }

    // Reutiliza/crea el token activo: produce el mismo enlace que muestra el QR.
    const confirmationData = await this.createConfirmation(
      operationId,
      operation,
    );
    const tokenTtlMinutes = this.getTokenValidityMinutes();
    const serviceLabel = await this.servicesForSendByEmail(operationId);
    const serviceCode = await this.getClientServiceCode(operationId);

    const emailResult =
      await this.operationEmailService.sendSpecialOperationConfirmationEmail({
        to,
        operationId,
        confirmationLink: confirmationData.link,
        tokenTtlMinutes,
        subject: params?.subject,
        bodyMessage: params?.body,
        serviceLabel,
        serviceCode,
      });

    if (!emailResult.sent) {
      throw new ConflictException(
        emailResult.reason || 'No se pudo enviar el correo de confirmación',
      );
    }

    this.logger.log(
      `Correo de confirmación enviado manualmente para operación ${operationId} a ${to}`,
    );

    return {
      operationId,
      sent: true,
      to,
      messageId: emailResult.messageId,
      link: confirmationData.link,
    };
  }

  /**
   * Reenvía manualmente el correo de liquidación de una operación cuya
   * factura ya fue creada (status TO_APPROVED) pero está a la espera del
   * número de radicado. Útil cuando el equipo de liquidación no recibió o
   * no encontró el correo original (falla de internet, bandeja saturada,
   * etc.). Genera un nuevo enlace de liquidación y expira los anteriores
   * para no dejar varios tokens activos apuntando a links distintos.
   */
  async resendLiquidationEmail(operationId: number): Promise<{
    operationId: number;
    sent: boolean;
    to: string[];
  }> {
    if (!operationId || operationId <= 0) {
      throw new BadRequestException('operationId inválido');
    }

    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: { id: true },
    });
    if (!operation) {
      throw new OperationNotFoundException(operationId);
    }

    // Debe existir una factura pendiente de radicado para esta operación.
    const pendingBill = await this.prisma.bill.findFirst({
      where: { id_operation: operationId, status: BillStatus.TO_APPROVED },
      select: { id: true },
    });
    if (!pendingBill) {
      throw new ConflictException(
        'La operación no tiene una factura pendiente de radicado (TO_APPROVED) para reenviar el correo de liquidación',
      );
    }

    const confirmation = await this.prisma.operationConfirmation.findUnique({
      where: { id_operation: operationId },
      select: { id: true },
    });
    if (!confirmation) {
      throw new ConflictException(
        'La operación no tiene una confirmación asociada; no se puede generar el enlace de liquidación',
      );
    }

    const emailTargets = await this.resolveLiquidationEmails(operationId);
    if (emailTargets.length === 0) {
      throw new ConflictException(
        'No hay correos de liquidación configurados para el cliente de esta operación',
      );
    }

    // Expirar tokens de liquidación activos previos para no dejar varios
    // enlaces vivos apuntando a radicados distintos de la misma operación.
    await this.prisma.token.updateMany({
      where: {
        id_confirmation: confirmation.id,
        type: 'LIQUIDATION',
        status: TokenStatus.ACTIVE,
      },
      data: { status: TokenStatus.EXPIRED },
    });

    const clientLabel = await this.getClientLabel(operationId);
    const serviceLabel = await this.servicesForSendByEmail(operationId);
    const serviceCode = await this.getClientServiceCode(operationId);
    const liquidationTokenValue = await this.createLiquidationToken(operationId);
    if (!liquidationTokenValue) {
      throw new ConflictException('No se pudo generar el enlace de liquidación');
    }

    const liquidationLink = this.operationTokenService.buildLiquidationLink(liquidationTokenValue);

    const emailResult = await this.operationEmailService.sendLiquidationEmail({
      to: emailTargets,
      operationId,
      liquidationLink,
      clientLabel,
      serviceLabel,
      serviceCode,
    });

    if (!emailResult.sent) {
      throw new ConflictException(
        emailResult.reason || 'No se pudo reenviar el correo de liquidación',
      );
    }

    this.logger.log(
      `Correo de liquidación reenviado manualmente para operación ${operationId} a [${emailTargets.join(', ')}]`,
    );

    return { operationId, sent: true, to: emailTargets };
  }

  /**
   * Confirma una operación especial mediante token.
   * - APPROVE -> activa prefactura, mueve a APPROVED y luego a COMPLETED automáticamente
   * - REJECT -> operación entra a REJECTED
   */
  async confirmOperation(
    token: string,
    action: 'APPROVE' | 'REJECT',
    ipAddress?: string | null,
    device?: string | null,
    clientObservation?: string | null,
    supervisorObservation?: string | null,
  ) {
    // Sincroniza estado en BD: todo token ACTIVE vencido por tiempo pasa a EXPIRED.
    await this.expireActiveTokensByTime();

    if (!token || !token.trim()) {
      throw new BadRequestException('Token de confirmacion requerido');
    }

    if (!['APPROVE', 'REJECT'].includes(action)) {
      throw new BadRequestException('Accion invalida. Use APPROVE o REJECT');
    }

    const tokenRecord = await this.findTokenRecordByClientToken(token, {
      include: {
        confirmation: {
          include: {
            operation: {
              select: { id: true, status: true, id_user: true },
            },
          },
        },
      },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Token de confirmacion invalido');
    }

    if (
      tokenRecord.status === TokenStatus.CONFIRMED ||
      tokenRecord.status === TokenStatus.REJECTED
    ) {
      throw new BadRequestException('Token de confirmacion ya utilizado');
    }

    if (tokenRecord.status === TokenStatus.EXPIRED) {
      throw new BadRequestException('Token de confirmacion expirado');
    }

    // Expira por fecha de creación + 1 hora y persiste el estado EXPIRED.
    if (this.isTokenExpired(tokenRecord.createdAt)) {
      await this.prisma.token.update({
        where: { id: tokenRecord.id },
        data: { status: TokenStatus.EXPIRED },
      });
      throw new BadRequestException('Token de confirmacion expirado');
    }

    const operation = tokenRecord.confirmation?.operation;
    if (!operation) {
      throw new OperationNotFoundException(-1);
    }

    if (operation.status !== StatusOperation.TO_APPROVED) {
      throw new ConflictException(
        `La operacion ${operation.id} no esta pendiente de confirmacion`,
      );
    }

    const approvedStatus = 'APPROVED' as StatusOperation;
    const newStatus =
      action === 'APPROVE' ? approvedStatus : StatusOperation.REJECTED;
    const now = getColombianDateTime();

    if (action === 'APPROVE') {
      await this.ensurePreBillsForSpecialOperation(
        operation.id,
        operation.id_user ?? 1,
      );
    }

    const tokenFinalStatus =
      action === 'APPROVE' ? TokenStatus.CONFIRMED : TokenStatus.REJECTED;



    const result = await this.prisma.$transaction(async (tx) => {
      const updatedOperation = await tx.operation.update({
        where: { id: operation.id },
        data: { status: newStatus },
      });

      const updatedConfirmation = await tx.operationConfirmation.update({
        where: { id: tokenRecord.id_confirmation },
        data: {
          confirmedAt: now,
          ipAddress: ipAddress || null,
          device: device || null,
          clientObservation: clientObservation?.trim() ? clientObservation.trim() : null,
          supervisorObservation: supervisorObservation?.trim() ? supervisorObservation.trim() : null,
        },
      });

      await tx.token.update({
        where: { id: tokenRecord.id },
        data: {
          status: tokenFinalStatus,
          usedAt: now,
        },
      });

      await tx.token.updateMany({
        where: {
          id_confirmation: tokenRecord.id_confirmation,
          id: { not: tokenRecord.id },
          status: TokenStatus.ACTIVE,
        },
        data: {
          status: TokenStatus.EXPIRED,
        },
      });

      return { updatedOperation, updatedConfirmation };
    });

    this.logger.log(
      `Operacion ${operation.id} confirmada con accion ${action}. Nuevo estado: ${newStatus}`,
    );

    if (action === 'APPROVE') {
      const completedOperation =
        await this.autoCompleteConfirmedSpecialOperation(operation.id);

      // Dispatch liquidation email without blocking the response.
      this.sendLiquidationEmailForOperation(operation.id).catch((err) =>
        this.logger.error(
          `Error enviando email de liquidacion para operacion ${operation.id}: ${err?.message || err}`,
        ),
      );

      return {
        operation: completedOperation,
        confirmation: result.updatedConfirmation,
        action,
        movedTo: StatusOperation.COMPLETED,
      };
    }

    return {
      operation: result.updatedOperation,
      confirmation: result.updatedConfirmation,
      action,
      movedTo: newStatus,
    };
  }

  async submitRadicado(token: string, fileCode: string) {
    const normalizedToken = token?.trim();
    const normalizedFileCode = fileCode?.trim();

    if (!normalizedToken) {
      throw new BadRequestException('Token de liquidacion requerido');
    }

    if (!normalizedFileCode) {
      throw new BadRequestException('Numero de radicado requerido');
    }

    const tokenRecord = await this.findTokenRecordByClientToken(normalizedToken, {
      include: {
        confirmation: {
          include: {
            operation: { select: { id: true, status: true } },
          },
        },
      },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Token de liquidacion invalido');
    }

    if (tokenRecord.type !== 'LIQUIDATION') {
      throw new BadRequestException('Token de liquidacion invalido');
    }

    if (tokenRecord.status === TokenStatus.CONFIRMED) {
      throw new BadRequestException('El radicado ya fue registrado para esta operacion');
    }

    if (tokenRecord.status !== TokenStatus.ACTIVE) {
      throw new BadRequestException('Token de liquidacion invalido o expirado');
    }

    const confirmation = tokenRecord.confirmation;
    if (!confirmation?.operation) {
      throw new OperationNotFoundException(-1);
    }

    const now = getColombianDateTime();

    await this.prisma.$transaction(async (tx) => {
      await tx.operationConfirmation.update({
        where: { id: confirmation.id },
        data: { fileCodeRegistered: true },
      });

      await tx.token.update({
        where: { id: tokenRecord.id },
        data: { status: TokenStatus.CONFIRMED, usedAt: now },
      });

      const billUpdateResult = await tx.bill.updateMany({
        where: {
          id_operation: confirmation.operation.id,
          status: { in: [BillStatus.TO_APPROVED, BillStatus.ACTIVE] },
        },
        data: { status: BillStatus.ACTIVE, fileCode: normalizedFileCode },
      });

      if (billUpdateResult.count === 0) {
        this.logger.warn(
          `No se encontraron facturas TO_APPROVED/ACTIVE para registrar el radicado "${normalizedFileCode}" en la operacion ${confirmation.operation.id}`,
        );
      }
    });

    this.logger.log(
      `Radicado "${normalizedFileCode}" registrado para operacion ${confirmation.operation.id}`,
    );

    return {
      operationId: confirmation.operation.id,
      fileCode: normalizedFileCode,
    };
  }

  async getLiquidationPreviewByToken(token: string) {
    const normalizedToken = token?.trim();
    if (!normalizedToken) {
      throw new BadRequestException('Token de liquidacion requerido');
    }

    const tokenRecord = await this.findTokenRecordByClientToken(normalizedToken, {
      include: {
        confirmation: {
          include: {
            operation: {
              select: {
                id: true,
                status: true,
                dateStart: true,
                dateEnd: true,
                timeStrat: true,
                timeEnd: true,
                motorShip: true,
                zone: {
                  select: {
                    name: true,
                  },
                },
                jobArea: { select: { name: true } },
                client: { select: { name: true } },
                task: { select: { name: true } },
                Site: { select: { name: true } },
                subSite: { select: { name: true } },
                Bill: {
                  select: {
                    id_group: true,
                    amount: true,
                    number_of_hours: true,
                    group_hours: true,
                  },
                },
                clientProgramming: {
                  select: { service_request: true },
                },
                workers: {
                  select: {
                    id_worker: true,
                    id_group: true,
                    dateStart: true,
                    dateEnd: true,
                    timeStart: true,
                    timeEnd: true,
                    SubTask: { select: { name: true } },
                    tariff: {
                      select: {
                        pay_units: true,
                        unitOfMeasure: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!tokenRecord || !tokenRecord.confirmation?.operation) {
      throw new BadRequestException('Token de liquidacion invalido');
    }

    if (tokenRecord.type !== 'LIQUIDATION') {
      throw new BadRequestException('Token de liquidacion invalido');
    }

    const canSubmit = tokenRecord.status === TokenStatus.ACTIVE;
    const operation = tokenRecord.confirmation.operation;

    // Mapa de Bills por id_group, para usar horas ya facturadas como respaldo
    // cuando la fecha/hora de los trabajadores no permite calcularlas.
    const billMap = new Map<string, any>();
    for (const bill of operation.Bill || []) {
      if (bill.id_group) {
        billMap.set(bill.id_group, bill);
      }
    }

    const groupMap = new Map<
      string,
      {
        workerIds: Set<number>;
        subservices: Set<string>;
        unitNames: Set<string>;
        totalQuantity: number;
        dateStart: Date | null;
        timeStart: string | null;
        dateEnd: Date | null;
        timeEnd: string | null;
      }
    >();

    for (const row of operation.workers || []) {
      const groupId = (row.id_group || 'SIN_GRUPO').trim();
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, {
          workerIds: new Set(),
          subservices: new Set(),
          unitNames: new Set(),
          totalQuantity: 0,
          dateStart: null,
          timeStart: null,
          dateEnd: null,
          timeEnd: null,
        });
      }
      const g = groupMap.get(groupId)!;
      g.workerIds.add(row.id_worker);
      if (row.SubTask?.name) g.subservices.add(row.SubTask.name);
      if (row.tariff?.unitOfMeasure?.name) g.unitNames.add(row.tariff.unitOfMeasure.name);
      if (row.tariff?.pay_units) g.totalQuantity += Number(row.tariff.pay_units);

      this.mergeGroupDateRange(g, row.dateStart, row.timeStart, row.dateEnd, row.timeEnd);
    }

    const groups = Array.from(groupMap.entries()).map(([groupId, g]) => {
      const bill = billMap.get(groupId);
      // ✅ Duración del rango del grupo (una sola vez, no por trabajador): todos
      // los trabajadores de un grupo comparten el mismo horario, así que sumar
      // la duración por cada fila la multiplicaba por la cantidad de personas
      // (p.ej. 2h reales x 2 trabajadores mostraban "4.0 h").
      const rangeHours =
        g.dateStart && g.timeStart && g.dateEnd && g.timeEnd
          ? this.calculateOperationDuration(g.dateStart, g.timeStart, g.dateEnd, g.timeEnd)
          : 0;
      // ✅ Preferir las horas ya guardadas en la factura del grupo; si no hay
      // factura (o no tiene horas), usar la duración calculada del rango.
      const billHours = Number(bill?.number_of_hours ?? bill?.group_hours ?? 0);
      const totalHoursWorked = billHours > 0 ? billHours : rangeHours;

      return {
        groupId,
        workersCount: g.workerIds.size,
        totalHoursWorked: Math.round(totalHoursWorked * 100) / 100,
        subservices: Array.from(g.subservices),
        unitMeasures: Array.from(g.unitNames),
        quantity: Math.round(g.totalQuantity * 100) / 100,
        amount: bill?.amount ?? 0,
        dateStart: g.dateStart,
        timeStart: g.timeStart,
        dateStartFormatted: g.dateStart ? formatColombianDate(g.dateStart) : null,
        timeStartFormatted: this.formatTimeForDisplay(g.timeStart),
        dateEnd: g.dateEnd,
        timeEnd: g.timeEnd,
        dateEndFormatted: g.dateEnd ? formatColombianDate(g.dateEnd) : null,
        timeEndFormatted: this.formatTimeForDisplay(g.timeEnd),
      };
    });

    return {
      token: { status: tokenRecord.status, createdAt: tokenRecord.createdAt },
      operation,
      groupSummary: {
        groups,
        totalGroups: groups.length,
        totalWorkers: groups.reduce((s, g) => s + (g.workersCount ?? 0), 0),
      },
      canSubmit,
    };
  }

  private async sendLiquidationEmailForOperation(operationId: number): Promise<void> {
    const emailTargets = await this.resolveLiquidationEmails(operationId);
    if (emailTargets.length === 0) {
      this.logger.warn(`No se encontraron correos de liquidacion para operacion ${operationId}`);
      return;
    }

    const clientLabel = await this.getClientLabel(operationId);
    const serviceLabel = await this.servicesForSendByEmail(operationId);
    const serviceCode = await this.getClientServiceCode(operationId);
    const liquidationTokenValue = await this.createLiquidationToken(operationId);
    if (!liquidationTokenValue) {
      this.logger.warn(`No se pudo generar token de liquidacion para operacion ${operationId}`);
      return;
    }

    const liquidationLink = this.operationTokenService.buildLiquidationLink(liquidationTokenValue);

    await this.operationEmailService.sendLiquidationEmail({
      to: emailTargets,
      operationId,
      liquidationLink,
      clientLabel,
      serviceLabel,
      serviceCode,
    });
  }

  private async createLiquidationToken(operationId: number): Promise<string | null> {
    const confirmation = await this.prisma.operationConfirmation.findUnique({
      where: { id_operation: operationId },
      select: { id: true },
    });

    if (!confirmation) return null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const tokenValue = this.operationTokenService.generateTokenValue();
      const tokenHash = this.operationTokenService.hashTokenValue(tokenValue);

      try {
        await this.prisma.token.create({
          data: {
            id_confirmation: confirmation.id,
            tokenHash,
            status: TokenStatus.ACTIVE,
            type: 'LIQUIDATION',
          },
        });
        return tokenValue;
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
      }
    }

    return null;
  }

  private async resolveLiquidationEmails(operationId: number): Promise<string[]> {
    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: { id_client: true },
    });

    if (!operation?.id_client) return [];

    const emails = await this.prisma.clientEmail.findMany({
      where: {
        id_client: operation.id_client,
        type: 'LIQUIDATION',
        status: 'ACTIVE',
      },
      select: { email: true },
    });

    return emails.map((e) => e.email);
  }

  private async getClientLabel(operationId: number): Promise<string | null> {
    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: { client: { select: { name: true } } },
    });
    return operation?.client?.name ?? null;
  }
  private async ensurePreBillsForSpecialOperation(
    operationId: number,
    userId: number,
  ): Promise<void> {
    return;
  }

  private async updateBillStatusesForOperation(
    operationId: number,
    fromStatus: BillStatus,
    toStatus: BillStatus,
  ): Promise<void> {
    await this.prisma.bill.updateMany({
      where: {
        id_operation: operationId,
        status: fromStatus,
      },
      data: {
        status: toStatus,
      },
    });
  }

  private async autoCompleteConfirmedSpecialOperation(operationId: number) {
    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: {
        id: true,
        status: true,
        dateStart: true,
        timeStrat: true,
      },
    });

    if (!operation) {
      throw new OperationNotFoundException(operationId);
    }

    const approvedStatus = 'APPROVED' as StatusOperation;

    if (operation.status !== approvedStatus) {
      throw new ConflictException(
        `La operación ${operationId} no está en estado APPROVED`,
      );
    }

    const confirmation = await this.prisma.operationConfirmation.findUnique({
      where: { id_operation: operationId },
      select: { confirmedAt: true },
    });

    if (!confirmation?.confirmedAt) {
      throw new ConflictException(
        `La operación ${operationId} no tiene confirmación registrada`,
      );
    }

    const billCount = await this.prisma.bill.count({
      where: { id_operation: operationId },
    });

    if (billCount === 0) {
      throw new ConflictException(
        `La operación ${operationId} no tiene prefacturas para completar`,
      );
    }

    // const nonActiveBills = await this.prisma.bill.count({
    //   where: {
    //     id_operation: operationId,
    //     status: {
    //       not: BillStatus.ACTIVE,
    //     },
    //   },
    // });

    // if (nonActiveBills > 0) {
    //   throw new ConflictException(
    //     `La operación ${operationId} tiene facturas sin activar`,
    //   );
    // }

    const latestEndDateTime = await this.getLatestGroupEndDateTime(operationId);

    if (!latestEndDateTime) {
      throw new ConflictException(
        `No fue posible determinar la fecha de finalización de la operación ${operationId}`,
      );
    }

    const opDuration =
      operation.dateStart && operation.timeStrat
        ? this.calculateOperationDuration(
          operation.dateStart,
          operation.timeStrat,
          latestEndDateTime.date,
          latestEndDateTime.time,
        )
        : 0;

    const completedOperation = await this.prisma.operation.update({
      where: { id: operationId },
      data: {
        status: StatusOperation.COMPLETED,
        dateEnd: latestEndDateTime.date,
        timeEnd: latestEndDateTime.time,
        op_duration: opDuration,
      },
    });

    await this.operationWorkerService.completeClientProgramming(operationId);
    await this.operationWorkerService.releaseAllWorkersFromOperation(
      operationId,
    );
    await this.workerService.addWorkedHoursOnOperationEnd(operationId);

    return completedOperation;
  }

  private async getLatestGroupEndDateTime(
    operationId: number,
  ): Promise<{ date: Date; time: string } | null> {
    const workers = await this.prisma.operation_Worker.findMany({
      where: {
        id_operation: operationId,
        dateEnd: { not: null },
        timeEnd: { not: null },
      },
      select: {
        dateEnd: true,
        timeEnd: true,
      },
    });

    if (!workers.length) {
      return null;
    }

    let latestDateTime: Date | null = null;
    let latestResult: { date: Date; time: string } | null = null;

    for (const worker of workers) {
      if (!worker.dateEnd || !worker.timeEnd) {
        continue;
      }

      const [hours, minutes] = worker.timeEnd.split(':').map(Number);
      const dateTime = new Date(worker.dateEnd);
      dateTime.setHours(hours, minutes, 0, 0);

      if (!latestDateTime || dateTime > latestDateTime) {
        latestDateTime = dateTime;
        latestResult = {
          date: worker.dateEnd,
          time: worker.timeEnd,
        };
      }
    }

    return latestResult;
  }

  async getConfirmationPreviewByToken(token: string) {
    // Sincroniza estado en BD: todo token ACTIVE vencido por tiempo pasa a EXPIRED.
    await this.expireActiveTokensByTime();

    const normalizedToken = token?.trim();
    if (!normalizedToken) {
      throw new BadRequestException('Token de confirmacion requerido');
    }

    const tokenRecord = await this.findTokenRecordByClientToken(
      normalizedToken,
      {
        include: {
          confirmation: {
            include: {
              operation: {
                select: {
                  id: true,
                  status: true,
                  dateStart: true,
                  dateEnd: true,
                  timeStrat: true,
                  timeEnd: true,
                  motorShip: true,
                  zone: {
                    select: {
                      name: true,
                    },
                  },
                  jobArea: { select: { name: true } },
                  client: { select: { name: true } },
                  task: { select: { name: true } },
                  Site: { select: { name: true } },
                  subSite: { select: { name: true } },
                  Bill: {
                    select: {
                      id_group: true,
                      amount: true,
                      number_of_hours: true,
                      group_hours: true,
                    },
                  },
                  clientProgramming: {
                    select: {
                      service_request: true,
                    },
                  },
                  workers: {
                    select: {
                      id_worker: true,
                      id_group: true,
                      dateStart: true,
                      dateEnd: true,
                      timeStart: true,
                      timeEnd: true,
                      SubTask: {
                        select: {
                          name: true,
                        },
                      },
                      tariff: {
                        select: {
                          pay_units: true,
                          unitOfMeasure: {
                            select: {
                              name: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    );

    if (!tokenRecord || !tokenRecord.confirmation?.operation) {
      throw new BadRequestException('Token de confirmacion invalido');
    }

    const tokenTtlMinutes = this.getTokenValidityMinutes();
    const expiresAt = this.getTokenExpiresAt(tokenRecord.createdAt);
    const nowMs = Date.now();

    let tokenStatus = tokenRecord.status;
    if (tokenStatus === TokenStatus.ACTIVE && expiresAt.getTime() <= nowMs) {
      // Si venció durante preview, persistimos EXPIRED para mantener consistencia.
      await this.prisma.token.update({
        where: { id: tokenRecord.id },
        data: { status: TokenStatus.EXPIRED },
      });
      tokenStatus = TokenStatus.EXPIRED;
    }

    const operation = tokenRecord.confirmation.operation;
    const canConfirm =
      tokenStatus === TokenStatus.ACTIVE &&
      operation.status === StatusOperation.TO_APPROVED;
    // Construir mapa de Bills por id_group
    const billMap = new Map<string, any>();
    for (const bill of operation.Bill || []) {
      if (bill.id_group) {
        billMap.set(bill.id_group, bill);
      }
    }
    const groupMap = new Map<
      string,
      {
        workerIds: Set<number>;
        subservices: Set<string>;
        unitNames: Set<string>;
        totalQuantity: number;
        dateStart: Date | null;
        timeStart: string | null;
        dateEnd: Date | null;
        timeEnd: string | null;
      }
    >();

    for (const row of operation.workers || []) {
      const groupId = (row.id_group || 'SIN_GRUPO').trim();
      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, {
          workerIds: new Set<number>(),
          subservices: new Set<string>(),
          unitNames: new Set<string>(),
          totalQuantity: 0,
          dateStart: null,
          timeStart: null,
          dateEnd: null,
          timeEnd: null,
        });
      }

      const group = groupMap.get(groupId)!;
      group.workerIds.add(row.id_worker);

      this.mergeGroupDateRange(group, row.dateStart, row.timeStart, row.dateEnd, row.timeEnd);

      if (row.SubTask?.name?.trim()) {
        group.subservices.add(row.SubTask.name.trim());
      }

      const unitName = row.tariff?.unitOfMeasure?.name?.trim();
      if (unitName) {
        group.unitNames.add(unitName);
      }

      const rowQuantity = Number(row.tariff?.pay_units ?? 0);
      if (Number.isFinite(rowQuantity)) {
        group.totalQuantity += rowQuantity;
      }
    }

    const groups = Array.from(groupMap.entries()).map(([groupId, group]) => {
      // ✅ Duración del rango del grupo (una sola vez, no sumada por cada
      // trabajador): todos comparten el mismo horario, así que sumar por fila
      // multiplicaba la duración real por la cantidad de personas del grupo.
      const rangeHours =
        group.dateStart && group.timeStart && group.dateEnd && group.timeEnd
          ? this.calculateOperationDuration(
              group.dateStart,
              group.timeStart,
              group.dateEnd,
              group.timeEnd,
            )
          : 0;

      return {
        groupId,
        workersCount: group.workerIds.size,
        totalHoursWorked: Math.round(rangeHours * 100) / 100,
        subservices: Array.from(group.subservices),
        unitOfMeasure: Array.from(group.unitNames),
        quantity: Math.round(group.totalQuantity * 1000) / 1000,
        dateStart: group.dateStart,
        timeStart: group.timeStart,
        dateStartFormatted: group.dateStart ? formatColombianDate(group.dateStart) : null,
        timeStartFormatted: this.formatTimeForDisplay(group.timeStart),
        dateEnd: group.dateEnd,
        timeEnd: group.timeEnd,
        dateEndFormatted: group.dateEnd ? formatColombianDate(group.dateEnd) : null,
        timeEndFormatted: this.formatTimeForDisplay(group.timeEnd),
      };
    });

    // Se unifica salida en `operation` (general) y `groups` (detalle por grupo).
    const previewGroups = groups.map((group) => {
      const bill = billMap.get(group.groupId);
      // Usar Bill.number_of_hours si existe, de lo contrario usar el calculado
      const billHours = bill?.number_of_hours ? Number(bill.number_of_hours) : group.totalHoursWorked;
      const amount = bill?.amount ?? 0;

      return {
        idGrupo: group.groupId,
        subservicio: group.subservices,
        cantTrabajadores: group.workersCount,
        horasTrabajadas: Math.round(billHours * 100) / 100,
        amount: amount,
        unidadDeMedida: group.unitOfMeasure,
        dateStart: group.dateStart,
        timeStart: group.timeStart,
        dateStartFormatted: group.dateStartFormatted,
        timeStartFormatted: group.timeStartFormatted,
        dateEnd: group.dateEnd,
        timeEnd: group.timeEnd,
        dateEndFormatted: group.dateEndFormatted,
        timeEndFormatted: group.timeEndFormatted,
      };
    });

    // ✅ Se suma el conteo por grupo (no un Set global) para que coincida con
    // las tarjetas mostradas al usuario: un mismo trabajador puede repetirse
    // en más de un grupo dentro de la misma operación especial.
    const totalWorkers = groups.reduce((sum, group) => sum + group.workersCount, 0);

    return {
      token: {
        status: tokenStatus,
        createdAt: tokenRecord.createdAt,
        expiresAt,
        remainingSeconds: Math.max(
          0,
          Math.floor((expiresAt.getTime() - nowMs) / 1000),
        ),
      },
      operation: {
        id: operation.id,
        status: operation.status,
        serviceRequest: (operation as any).clientProgramming?.service_request || null,
        client: operation.client?.name || null,
        area: operation.jobArea?.name || null,
        service: operation.task?.name || null,
        motorShip: operation.motorShip || null,
        zone: operation.zone?.name || null,
        dateStart: operation.dateStart,
        dateStartFormatted: formatColombianDate(operation.dateStart),
        timeStart: operation.timeStrat,
        timeStartFormatted: this.formatTimeForDisplay(operation.timeStrat),
        dateEnd: operation.dateEnd || null,
        dateEndFormatted: operation.dateEnd ? formatColombianDate(operation.dateEnd) : null,
        timeEnd: operation.timeEnd || null,
        timeEndFormatted: this.formatTimeForDisplay(operation.timeEnd),
        site: operation.Site?.name || null,
        subsite: operation.subSite?.name || null,
      },
      groups: previewGroups,
      totals: {
        totalGroups: groups.length,
        totalWorkers,
      },
      canConfirm,
    };
  }

  private formatTimeForDisplay(timeValue?: string | null): string | null {
    if (!timeValue || !/^\d{1,2}:\d{2}$/.test(timeValue.trim())) {
      return null;
    }

    const [hourText, minuteText] = timeValue.trim().split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);

    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      return null;
    }

    const period = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour12.toString().padStart(2, '0')}:${minute
      .toString()
      .padStart(2, '0')} ${period}`;
  }

  /**
   * Actualiza in-place el rango fecha/hora de un grupo tomando el mínimo
   * inicio y el máximo fin entre todos los trabajadores que lo componen.
   * Se usa para mostrar el inicio/fin real de cada grupo en los portales
   * de confirmación y liquidación (antes solo se exponía a nivel operación).
   */
  private mergeGroupDateRange(
    group: {
      dateStart: Date | null;
      timeStart: string | null;
      dateEnd: Date | null;
      timeEnd: string | null;
    },
    rowDateStart?: Date | null,
    rowTimeStart?: string | null,
    rowDateEnd?: Date | null,
    rowTimeEnd?: string | null,
  ): void {
    const toTimestamp = (date?: Date | null, time?: string | null): number | null => {
      if (!date) return null;
      const d = new Date(date);
      if (time && /^\d{1,2}:\d{2}$/.test(time.trim())) {
        const [h, m] = time.trim().split(':').map(Number);
        d.setHours(h, m, 0, 0);
      }
      return d.getTime();
    };

    const currentStart = toTimestamp(group.dateStart, group.timeStart);
    const rowStart = toTimestamp(rowDateStart, rowTimeStart);
    if (rowStart !== null && (currentStart === null || rowStart < currentStart)) {
      group.dateStart = rowDateStart ?? null;
      group.timeStart = rowTimeStart ?? null;
    }

    const currentEnd = toTimestamp(group.dateEnd, group.timeEnd);
    const rowEnd = toTimestamp(rowDateEnd, rowTimeEnd);
    if (rowEnd !== null && (currentEnd === null || rowEnd > currentEnd)) {
      group.dateEnd = rowDateEnd ?? null;
      group.timeEnd = rowTimeEnd ?? null;
    }
  }

  /**
   * Regenera un token de confirmación para una operación especial.
   * - Valida que la operación exista
   * - Verifica que pueda ser confirmada (no esté completada/cancelada)
   * - Genera un nuevo token (tokens anteriores activos se marcan como EXPIRED)
   * - Retorna el nuevo link
   */
  async regenerateConfirmationToken(operationId: number): Promise<{
    operationId: number;
    confirmation: any;
    token: any;
    link: string;
    tokenTtlMinutes: number;
  }> {
    // Sincroniza estado en BD: todo token ACTIVE vencido por tiempo pasa a EXPIRED.
    await this.expireActiveTokensByTime();

    if (!operationId || operationId <= 0) {
      throw new BadRequestException('operationId inválido');
    }

    // Validar que la operación existe
    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: { id: true, status: true },
    });

    if (!operation) {
      throw new OperationNotFoundException(operationId);
    }

    // Verificar que sea especial
    const isSpecial = await this.isOperationSpecial(operationId, operation);
    if (!isSpecial) {
      throw new ConflictException(
        'La operación no es especial y no requiere confirmación',
      );
    }

    // Verificar que pueda ser confirmada (debe estar en TO_APPROVED)
    if (operation.status !== StatusOperation.TO_APPROVED) {
      throw new ConflictException(
        `La operación ${operationId} no está pendiente de confirmación. Estado actual: ${operation.status}`,
      );
    }

    // Obtener la confirmación existente
    const confirmation = await this.prisma.operationConfirmation.findUnique({
      where: { id_operation: operationId },
    });

    if (!confirmation) {
      throw new NotFoundException(
        `No existe confirmación para la operación ${operationId}`,
      );
    }

    const latestToken = await this.prisma.token.findFirst({
      where: { id_confirmation: confirmation.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    });

    const cooldownSeconds = this.getTokenRegenerationCooldownSeconds();
    if (latestToken && cooldownSeconds > 0) {
      const elapsedMs = Date.now() - latestToken.createdAt.getTime();
      const cooldownMs = cooldownSeconds * 1000;

      if (elapsedMs < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
        throw new HttpException(
          `Debe esperar ${remainingSeconds} segundos antes de regenerar un nuevo token para la operación ${operationId}`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    await this.prisma.token.updateMany({
      where: {
        id_confirmation: confirmation.id,
        status: TokenStatus.ACTIVE,
      },
      data: {
        status: TokenStatus.EXPIRED,
      },
    });

    this.logger.log(
      `Regenerando token para confirmacion ${confirmation.id} (operacion ${operationId}). Tokens activos anteriores marcados como EXPIRED.`,
    );

    // Generar nuevo token
    // En regeneración también se persiste únicamente el hash del nuevo token.
    let createdToken: {
      id: number;
      tokenHash: string;
      createdAt: Date;
      status: TokenStatus;
    } | null = null;
    let rawTokenValue: string | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const tokenValue = this.operationTokenService.generateTokenValue();
      // Token plano para cliente + hash para persistencia segura.
      const tokenHash = this.operationTokenService.hashTokenValue(tokenValue);

      try {
        createdToken = await this.prisma.token.create({
          data: {
            id_confirmation: confirmation.id,
            tokenHash,
            status: TokenStatus.ACTIVE,
          },
          select: {
            id: true,
            tokenHash: true,
            createdAt: true,
            status: true,
          },
        });
        rawTokenValue = tokenValue;
        break;
      } catch (error: any) {
        const isUniqueTokenError = error?.code === 'P2002';
        if (!isUniqueTokenError) {
          this.logger.error(
            `Error persistiendo token regenerado para operacion ${operationId}: ${error?.message || 'unknown error'} (code: ${error?.code || 'N/A'})`,
          );
          throw new TokenGenerationFailedException(
            operationId,
            `Error de base de datos al persistir token regenerado: ${error?.message || 'unknown error'}`,
          );
        }

        if (attempt === 4) {
          throw new TokenGenerationFailedException(
            operationId,
            'No se pudo persistir un token único para la confirmación tras múltiples reintentos',
          );
        }
      }
    }

    if (!createdToken) {
      throw new TokenGenerationFailedException(
        operationId,
        'No se pudo generar nuevo token de confirmación',
      );
    }

    // Garantiza que el link de respuesta siempre tenga token válido.
    if (!rawTokenValue) {
      throw new TokenGenerationFailedException(
        operationId,
        'No se pudo recuperar el nuevo token de confirmación generado',
      );
    }

    const link =
      this.operationTokenService.buildConfirmationLink(rawTokenValue);

    // Solo para facilitar pruebas manuales: imprime el link completo de acceso al portal.
    this.logger.warn(
      `LINK_CONFIRMACION_PORTAL operacion=${operationId} confirmation=${confirmation.id} link=${link}`,
    );

    const tokenTtlMinutes = this.getTokenValidityMinutes();

    this.logger.log(
      `Token regenerado ${createdToken.id} para confirmacion ${confirmation.id} (operacion ${operationId})`,
    );

    return {
      operationId,
      confirmation,
      token: createdToken,
      link,
      tokenTtlMinutes,
    };
  }

  private getTokenValidityMinutes(): number {
    // Se mantiene fijo por regla de negocio, sin depender de variables de entorno.
    return OperationService.TOKEN_VALIDITY_MINUTES;
  }

  private getTokenExpiresAt(createdAt: Date): Date {
    // La expiración siempre se calcula desde la fecha de creación del token.
    const validityMs = this.getTokenValidityMinutes() * 60 * 1000;
    return new Date(createdAt.getTime() + validityMs);
  }

  private isTokenExpired(createdAt: Date): boolean {
    // Consideramos expirado si ya alcanzó o superó el límite de 1 hora.
    return Date.now() >= this.getTokenExpiresAt(createdAt).getTime();
  }

  // Expone la expiración de tokens para que un cron externo pueda sincronizar el estado en BD.
  async expireConfirmationTokens(): Promise<number> {
    return await this.expireActiveTokensByTime();
  }

  private async expireActiveTokensByTime(): Promise<number> {
    const expirationThreshold = new Date(
      Date.now() - this.getTokenValidityMinutes() * 60 * 1000,
    );

    const expired = await this.prisma.token.updateMany({
      where: {
        status: TokenStatus.ACTIVE,
        createdAt: {
          lte: expirationThreshold,
        },
      },
      data: {
        status: TokenStatus.EXPIRED,
      },
    });

    return expired.count;
  }

  private getTokenRegenerationCooldownSeconds(): number {
    const configured = Number(
      process.env.OPERATION_CONFIRMATION_TOKEN_REGEN_COOLDOWN_SECONDS || 30,
    );

    if (!Number.isFinite(configured) || configured < 0) {
      return 30;
    }

    return Math.floor(configured);
  }

  private async findTokenRecordByClientToken(
    token: string,
    args?: any,
  ): Promise<any> {
    const normalizedToken = token?.trim();
    if (!normalizedToken) {
      return null;
    }

    const tokenHashFromRaw =
      this.operationTokenService.hashTokenValue(normalizedToken);

    const findByRaw = await this.prisma.token.findUnique({
      where: { tokenHash: tokenHashFromRaw },
      ...(args || {}),
    });

    return findByRaw ?? null;
  }

  private async resolveClientConfirmationEmail(
    operationId: number,
  ): Promise<string | null> {
    const operationContact = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: {
        client: {
          select: {
            name: true,
          },
        },
        clientProgramming: {
          select: {
            client: true,
          },
        },
      },
    });

    const candidates = [
      operationContact?.clientProgramming?.client,
      operationContact?.client?.name,
      process.env.CONFIRMATION_DEFAULT_EMAIL,
    ];

    for (const candidate of candidates) {
      const normalized = (candidate || '').trim();
      if (this.isValidEmail(normalized)) {
        return normalized;
      }
    }

    return null;
  }

  private isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  /**
   * Resuelve un texto legible con el/los servicio(s) de una operación,
   * para usarlo en el asunto y encabezado del correo de confirmación.
   * Prioriza los subservicios (SubTask) de los grupos de trabajadores y,
   * si no hay ninguno, cae al servicio general (Task) de la operación.
   */
  private async servicesForSendByEmail(
    operationId: number,
  ): Promise<string | null> {
    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: {
        task: { select: { name: true } },
        workers: {
          where: { id_worker: { not: -1 } },
          select: { SubTask: { select: { name: true } } },
        },
      },
    });

    const subserviceNames = Array.from(
      new Set(
        (operation?.workers || [])
          .map((w) => w.SubTask?.name?.trim())
          .filter((name): name is string => !!name),
      ),
    );

    if (subserviceNames.length > 0) {
      return subserviceNames.join(', ');
    }

    return operation?.task?.name?.trim() || null;
  }

  /**
   * Código de servicio que el CLIENTE reconoce (el que ellos mismos radicaron
   * al programar el servicio). Se usa en los correos en lugar del id interno
   * de operación, que el cliente no conoce.
   */
  private async getClientServiceCode(operationId: number): Promise<string | null> {
    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
      select: {
        clientProgramming: { select: { service_request: true } },
      },
    });

    return operation?.clientProgramming?.service_request?.trim() || null;
  }

  /**
   * Combina una fecha (solo día) con una hora "HH:MM" en un único Date local.
   * Si no se recibe hora, retorna la fecha a medianoche.
   */
  private combineDateAndTime(date: Date | string, time?: string): Date {
    const combined = toLocalDate(date);
    if (time) {
      const [hours, minutes] = time.split(':').map(Number);
      combined.setHours(hours || 0, minutes || 0, 0, 0);
    }
    return combined;
  }

  /**
   * Restricción por SEMANAS_COMPLETAR_OPERACIONES: solo aplica al SUPERVISOR y gobierna
   * el alcance hacia atrás para CREAR/EDITAR una operación (iniciar, completar y eliminar
   * no se ven afectados por esta configuración). Si está ACTIVE, su "value" indica cuántas
   * semanas hacia atrás (incluyendo la semana actual) puede crear/editar una operación.
   * Ej: value=2 habilita crear/editar operaciones con dateStart de la semana actual o de
   * la semana inmediatamente anterior; más atrás de eso queda bloqueado. Si está INACTIVE
   * no se aplica ningún límite.
   */
  private async validateWeeksLimitForEdit(
    isSupervisor: boolean,
    dateStart?: string | Date | null,
  ): Promise<{ message: string; status: number } | null> {
    if (!isSupervisor || !dateStart) return null;

    const semanasConfig = await this.configurationService.findOneByName(
      'SEMANAS_COMPLETAR_OPERACIONES',
    );
    const isWeeksConfigActive =
      semanasConfig && semanasConfig.status === StatusActivation.ACTIVE;
    if (!isWeeksConfigActive) return null;

    const weeksLimit = Number(semanasConfig.value);
    const operationDate = toLocalDate(dateStart);

    // Inicio (lunes) de la semana actual, en hora colombiana
    const startOfCurrentWeek = getStartOfWeek(getColombianDateTime());

    // Límite inferior: retroceder (weeksLimit - 1) semanas desde el inicio de la semana actual
    const lowerBoundDate = new Date(startOfCurrentWeek);
    lowerBoundDate.setDate(startOfCurrentWeek.getDate() - (weeksLimit - 1) * 7);

    if (operationDate < lowerBoundDate) {
      return {
        message: `Como SUPERVISOR solo puedes crear/editar operaciones dentro de las últimas ${weeksLimit} semanas (a partir del ${formatColombianDate(lowerBoundDate)}).`,
        status: 400,
      };
    }
    return null;
  }

  /**
   * Excepciones puntuales a HORAS_REGISTRO_OPERACIONES para operaciones que arrancan
   * muy al final de una semana ISO (lunes-domingo: domingo es el último día, lunes es
   * el primer día de la semana siguiente) y por eso legítimamente no se pueden cerrar
   * sino ya entrada la semana siguiente. Son dos casos MUY específicos, no una regla
   * general — si no calzan exactamente, no aplican y se sigue la regla normal:
   *
   * 1) dateStart es DOMINGO (último día) de la semana inmediatamente anterior a "now",
   *    Y dateEnd es ese mismo lunes siguiente (dateStart + 1 día, primer día de la
   *    semana actual): se puede completar/eliminar hasta el final de ese lunes.
   * 2) dateStart es VIERNES de la semana inmediatamente anterior a "now", Y dateEnd es
   *    el MISMO día que dateStart (operación de un solo día): se puede completar/
   *    eliminar hasta el lunes de la semana actual — o el siguiente día hábil si ese
   *    lunes (u los siguientes) es festivo.
   *
   * Devuelve el resultado de la excepción aplicable, o `undefined` si ninguna de las
   * dos aplica (en cuyo caso el llamador debe seguir con la regla normal).
   */
  private getHoursLimitWeekendException(
    operationDate: Date,
    dateEnd: Date | null,
    now: Date,
  ): { message: string; status: number } | null | undefined {
    const startOfCurrentWeek = getStartOfWeek(now); // lunes de la semana ISO actual
    const startOfPreviousWeek = new Date(startOfCurrentWeek);
    startOfPreviousWeek.setDate(startOfCurrentWeek.getDate() - 7);

    const isInPreviousWeek =
      operationDate >= startOfPreviousWeek && operationDate < startOfCurrentWeek;
    if (!isInPreviousWeek) return undefined;

    const dayOfWeek = operationDate.getDay(); // 0=domingo ... 6=sábado

    // Caso 1: domingo (último día) -> se completa el lunes siguiente (dateEnd = dateStart + 1)
    if (dayOfWeek === 0 && dateEnd) {
      const expectedDateEnd = new Date(operationDate);
      expectedDateEnd.setDate(expectedDateEnd.getDate() + 1);
      if (dateEnd.getTime() === expectedDateEnd.getTime()) {
        const deadline = new Date(dateEnd);
        deadline.setHours(23, 59, 59, 999);
        if (now > deadline) {
          return {
            message: `Como SUPERVISOR ya pasó el plazo (${formatColombianDate(deadline)}) para completar o eliminar esta operación.`,
            status: 400,
          };
        }
        return null;
      }
    }

    // Caso 2: viernes, operación de un solo día -> plazo hasta el lunes (o el
    // siguiente día hábil si hay festivos) de la semana actual
    if (dayOfWeek === 5 && dateEnd && dateEnd.getTime() === operationDate.getTime()) {
      // startOfCurrentWeek ya ES el lunes de la semana actual (semana ISO)
      const deadlineDay = new Date(startOfCurrentWeek);
      while (isHoliday(deadlineDay)) {
        deadlineDay.setDate(deadlineDay.getDate() + 1);
      }
      const deadline = new Date(deadlineDay);
      deadline.setHours(23, 59, 59, 999);

      if (now > deadline) {
        return {
          message: `Como SUPERVISOR ya pasó el plazo (${formatColombianDate(deadline)}) para completar o eliminar esta operación.`,
          status: 400,
        };
      }
      return null;
    }

    return undefined;
  }

  /**
   * Restricción por HORAS_REGISTRO_OPERACIONES: solo aplica al SUPERVISOR y gobierna
   * COMPLETAR y ELIMINAR (crear/editar se rigen por SEMANAS_COMPLETAR_OPERACIONES e
   * iniciar no tiene restricción). Si está ACTIVE, solo se puede completar/eliminar una
   * operación cuyo dateStart caiga en la semana ACTUAL (ISO, lunes-domingo) y, además,
   * mientras no hayan pasado más de "value" horas desde su dateStart+timeStrat. Fuera
   * de la semana actual, o pasadas esas horas dentro de la semana actual, queda
   * bloqueado — SALVO que aplique una de las dos excepciones puntuales de
   * getHoursLimitWeekendException (operación que arranca domingo o viernes de la
   * semana anterior). Si está INACTIVE no se aplica ningún límite.
   */
  private async validateHoursLimitForCompleteOrDelete(
    isSupervisor: boolean,
    dateStart?: string | Date | null,
    timeStrat?: string | null,
    dateEnd?: string | Date | null,
  ): Promise<{ message: string; status: number } | null> {
    if (!isSupervisor || !dateStart) return null;

    const horasConfig = await this.configurationService.findOneByName(
      'HORAS_REGISTRO_OPERACIONES',
    );
    const isHoursConfigActive =
      horasConfig && horasConfig.status === StatusActivation.ACTIVE;
    if (!isHoursConfigActive) return null;

    const hoursLimit = Number(horasConfig.value);
    const now = getColombianDateTime();
    const operationDate = toLocalDate(dateStart);
    const operationEndDate = dateEnd ? toLocalDate(dateEnd) : null;

    const exceptionResult = this.getHoursLimitWeekendException(
      operationDate,
      operationEndDate,
      now,
    );
    if (exceptionResult !== undefined) return exceptionResult;

    const startOfCurrentWeek = getStartOfWeek(now);
    const startOfNextWeek = new Date(startOfCurrentWeek);
    startOfNextWeek.setDate(startOfCurrentWeek.getDate() + 7);

    // Solo se puede completar/eliminar dentro de la semana actual
    if (operationDate < startOfCurrentWeek || operationDate >= startOfNextWeek) {
      return {
        message: `Como SUPERVISOR solo puedes completar o eliminar operaciones de la semana actual.`,
        status: 400,
      };
    }

    const operationDateTime = this.combineDateAndTime(operationDate, timeStrat || undefined);
    const limitDateTime = new Date(
      operationDateTime.getTime() + hoursLimit * 60 * 60 * 1000,
    );

    if (now > limitDateTime) {
      return {
        message: `Como SUPERVISOR ya pasaron las ${hoursLimit} horas permitidas para completar o eliminar esta operación de la semana actual.`,
        status: 400,
      };
    }
    return null;
  }

  /**
   * Crea una nueva operación y asigna trabajadores
   * @param createOperationDto - Datos de la operación a crear
   * @returns Operación creada
   */
  async createWithWorkers(
    createOperationDto: CreateOperationDto,
    id_subsite?: number,
    id_site?: number,
  ) {
    try {
      // Si se está duplicando, forzar id_clientProgramming a null
      if ((createOperationDto as any).isDuplicate) {
        createOperationDto.id_clientProgramming = 0;
      }
      // console.log('[OperationService] ==> INICIANDO createWithWorkers');
      // console.log('[OperationService] createOperationDto:', JSON.stringify(createOperationDto, null, 2));

      if (createOperationDto.id_subsite) {
        id_subsite = createOperationDto.id_subsite;
      }

      // console.log('[OperationService] ==> Buscando usuario:', createOperationDto.id_user);
      // Obtener el usuario y su rol (ajusta según tu modelo)
      const user = await this.prisma.user.findUnique({
        where: { id: createOperationDto.id_user },
        select: { role: true },
      });
      // console.log('[OperationService] ==> Usuario encontrado:', user);

      // Validar semanas para SUPERVISOR (PROGRAMMER, ADMIN y SUPERADMIN no tienen esta restricción):
      // SEMANAS_COMPLETAR_OPERACIONES limita cuántas semanas hacia atrás puede el SUPERVISOR
      // crear una operación (completar/eliminar se rigen por HORAS_REGISTRO_OPERACIONES).
      const weeksLimitError = await this.validateWeeksLimitForEdit(
        user?.role === Role.SUPERVISOR,
        createOperationDto.dateStart,
      );
      if (weeksLimitError) return weeksLimitError;

      // console.log('[OperationService] ==> Validando user ID');
      // Validaciones
      if (createOperationDto.id_user === undefined) {
        // console.log('[OperationService] ==> Error: User ID requerido');
        return { message: 'User ID is required', status: 400 };
      }

      // console.log('[OperationService] ==> Extrayendo trabajadores e IDs');
      // Extraer y validar IDs de trabajadores
      const { workerIds = [], groups = [] } = createOperationDto;
      // console.log('[OperationService] ==> workerIds:', workerIds);
      // console.log('[OperationService] ==> groups:', JSON.stringify(groups, null, 2));

      const scheduledWorkerIds =
        this.relationService.extractScheduledWorkerIds(groups);
      const allWorkerIds = [...workerIds, ...scheduledWorkerIds];
      // console.log('[OperationService] ==> scheduledWorkerIds:', scheduledWorkerIds);
      // console.log('[OperationService] ==> allWorkerIds:', allWorkerIds);

      // console.log('[OperationService] ==> Validando worker IDs');
      const validateWorkerIds = await this.relationService.validateWorkerIds(
        allWorkerIds,
        id_subsite,
        id_site,
      );
      // console.log('[OperationService] ==> validateWorkerIds resultado:', validateWorkerIds);
      if (validateWorkerIds?.status === 403) {
        return validateWorkerIds;
      }

      // console.log('[OperationService] ==> Validando programación cliente');

      //validar programacion cliente
      const validateClientProgramming =
        await this.relationService.validateClientProgramming(
          createOperationDto.id_clientProgramming || null,
        );
      // console.log('[OperationService] ==> validateClientProgramming resultado:', validateClientProgramming);

      if (validateClientProgramming) return validateClientProgramming;

      // console.log('[OperationService] ==> Validando todos los IDs');
      // Validar todos los IDs
      const validationResult = await this.relationService.validateOperationIds(
        {
          id_area: createOperationDto.id_area,
          id_task: createOperationDto.id_task,
          id_client: createOperationDto.id_client,
          workerIds: allWorkerIds,
          inChargedIds: createOperationDto.inChargedIds,
        },
        groups,
        id_site,
      );
      //console.log('[OperationService] ==> validationResult:', validationResult);

      if (
        validationResult &&
        validationResult.status &&
        validationResult.status !== 200
      ) {
        // console.log('[OperationService] ==> Error en validación, retornando:', validationResult);
        return validationResult;
      }

      // console.log('[OperationService] ==> Creando operación');
      // Crear la operación
      const operation = await this.createOperation(
        createOperationDto,
        id_subsite,
      );
      //console.log('[OperationService] ==> Operación creada:', operation);

      // VERIFICAR SI HAY ERROR ANTES DE ACCEDER A 'id'
      if ('status' in operation && 'message' in operation) {
        // console.log('[OperationService] ==> Error en creación de operación:', operation);
        return operation;
      }

      // console.log('[OperationService] ==> Asignando trabajadores y encargados');
      // Asignar trabajadores y encargados
      const response = await this.relationService.assignWorkersAndInCharge(
        operation.id,
        workerIds,
        groups,
        createOperationDto.inChargedIds || [],
        id_subsite,
        id_site,
      );
      //  console.log('[OperationService] ==> Resultado asignación:', response);

      if (response && (response.status === 403 || response.status === 400)) {
        console.error('[OperationService] ==> Error en asignación:', response);
        return response;
      }

      //console.log('[OperationService] ==> SUCCESS: Operación creada con ID:', operation.id);
      return { id: operation.id };
    } catch (error) {
      console.error('[OperationService] ==> ERROR en createWithWorkers:', (error as Error).message);
      console.error('[OperationService] ==> Stack trace:', (error as Error).stack);
      throw new Error((error as Error).message);
    }
  }

  private calculateOperationDuration(
    dateStart: Date,
    timeStrat: string,
    dateEnd: Date,
    timeEnd: string,
  ): number {
    if (!dateStart || !timeStrat || !dateEnd || !timeEnd) return 0;

    const start = new Date(dateStart);
    const [sh, sm] = timeStrat.split(':').map(Number);
    start.setHours(sh, sm, 0, 0);

    const end = new Date(dateEnd);
    const [eh, em] = timeEnd.split(':').map(Number);
    end.setHours(eh, em, 0, 0);

    const diffMs = end.getTime() - start.getTime();
    const durationHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100; // 2 decimales
    return durationHours > 0 ? durationHours : 0;
  }

  /**
   * Crea un registro de operación
   * @param operationData - Datos de la operación
   * @returns Operación creada
   */
  private async createOperation(
    operationData: CreateOperationDto,
    id_subsite?: number,
  ) {
    const {
      workerIds,
      groups,
      inChargedIds,
      dateStart,
      dateEnd,
      timeStrat,
      timeEnd,
      id_clientProgramming,
      id_task,
      ...restOperationData
    } = operationData;

    // Si id_task no viene en operationData, pero sí en el primer grupo, úsalo
    const mainTaskId =
      id_task ||
      (groups && groups.length > 0 && groups[0].id_task
        ? groups[0].id_task
        : null);

    if (id_subsite !== undefined) {
      if (operationData.id_subsite !== id_subsite) {
        return { message: 'Subsite does not match', status: 400 };
      }
    }

    // ✅ CALCULAR op_duration SI SE PROPORCIONA FECHA Y HORA COMPLETAS
    let calculatedOpDuration = 0;
    if (dateStart && timeStrat && dateEnd && timeEnd) {
      const start = new Date(dateStart);
      const [sh, sm] = timeStrat.split(':').map(Number);
      start.setHours(sh, sm, 0, 0);

      const end = new Date(dateEnd);
      const [eh, em] = timeEnd.split(':').map(Number);
      end.setHours(eh, em, 0, 0);

      const diffMs = end.getTime() - start.getTime();
      calculatedOpDuration = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
      calculatedOpDuration = calculatedOpDuration > 0 ? calculatedOpDuration : 0;

      // console.log(`[OperationService] ✅ op_duration calculado al crear: ${calculatedOpDuration} horas`);
    }

    const newOperation = await this.prisma.operation.create({
      data: {
        ...restOperationData,
        id_user: operationData.id_user as number,
        id_clientProgramming: id_clientProgramming || null,
        id_task: mainTaskId,
        dateStart: dateStart,
        dateEnd: dateEnd ? new Date(dateEnd) : null,
        timeStrat: timeStrat,
        timeEnd: timeEnd || null,
        id_subsite: id_subsite || null,
        id_zone: operationData.id_zone ? operationData.id_zone : null,
        op_duration: calculatedOpDuration,
      },
    });

    // 🔔 DESPERTAR SISTEMA: Si se crea una operación, despertar el cron job del sueño profundo
    try {
      const { UpdateOperationService } = await import('../cron-job/services/update-operation.service');
      const updateOperationService = this.moduleRef.get(UpdateOperationService, { strict: false });
      updateOperationService.wakeUpFromDeepSleep(`Nueva operación creada (ID: ${newOperation.id})`);

      // // 🚀 PROCESAMIENTO INMEDIATO: También despertar el cron service para verificación inmediata
      // try {
      //   const { OperationsCronService } = await import('../cron-job/cron-job.service');
      //   const cronService = this.moduleRef.get(OperationsCronService, { strict: false });
      //   await cronService.wakeUpAndProcess(`Nueva operación creada desde Flutter/App (ID: ${newOperation.id})`);
      // } catch (cronError) {
      //   console.warn('[OperationService] ⚠️ Wake up exitoso, pero procesamiento inmediato falló:', cronError.message);
      // }
    } catch (error) {
      // No lanzar error si falla el wake up, solo loggear
      console.warn('[OperationService] ⚠️ No se pudo despertar el sistema automático:', (error as Error).message);
    }

    if (id_clientProgramming) {
      await this.prisma.clientProgramming.update({
        where: { id: id_clientProgramming },
        data: {
          status: StatusComplete.ASSIGNED,
        },
      });
    }
    return newOperation;
  }
  /**
   * Actualiza únicamente la embarcación (motorShip) de una operación, sin pasar
   * por el flujo completo de `update` (que maneja trabajadores, grupos, cambios
   * de estado, etc.). Pensado para edición rápida desde la pantalla de la Bill,
   * incluso cuando la operación ya está COMPLETED.
   */
  async updateVessel(id: number, motorShip: string) {
    const existingOperation = await this.prisma.operation.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existingOperation) {
      throw new OperationNotFoundException(id);
    }

    const updatedOperation = await this.prisma.operation.update({
      where: { id },
      data: { motorShip },
      select: { id: true, motorShip: true },
    });

    return {
      id: updatedOperation.id,
      motorShip: updatedOperation.motorShip,
      message: 'Embarcación actualizada exitosamente',
    };
  }

  /**
   * Actualiza una operación existente
   * @param id - ID de la operación a actualizar
   * @param updateOperationDto - Datos de actualización
   * @returns Operación actualizada
   */
  async update(
    id: number,
    updateOperationDto: UpdateOperationDto,
    id_subsite?: number,
    id_site?: number,
    isSupervisor?: boolean,
  ) {
    try {
      // --- PATCH: Actualizar status de ClientProgramming si cambia y site == 1 ---
      // Obtener la operación actual antes de actualizar
      const currentOp = await this.prisma.operation.findUnique({
        where: { id },
        select: { id_clientProgramming: true, id_site: true },
      });

      // Si el site es 1 y hay id_clientProgramming, asegurar que el status sea ASSIGNED
      if (
        currentOp &&
        currentOp.id_site === 1 &&
        updateOperationDto.id_clientProgramming
      ) {
        await this.prisma.clientProgramming.update({
          where: { id: updateOperationDto.id_clientProgramming },
          data: { status: StatusComplete.ASSIGNED },
        });
      }

      // Si el id_clientProgramming anterior era ASSIGNED y no está COMPLETED, ponerlo en UNASSIGNED si se libera
      if (
        currentOp &&
        currentOp.id_site === 1 &&
        currentOp.id_clientProgramming &&
        currentOp.id_clientProgramming !== updateOperationDto.id_clientProgramming
      ) {
        const prevCP = await this.prisma.clientProgramming.findUnique({
          where: { id: currentOp.id_clientProgramming },
          select: { status: true },
        });
        if (prevCP && prevCP.status === StatusComplete.ASSIGNED) {
          await this.prisma.clientProgramming.update({
            where: { id: currentOp.id_clientProgramming },
            data: { status: StatusComplete.UNASSIGNED },
          });
        }
      }
      // console.log('[OperationService] Iniciando actualización de operación:', id);
      // console.log('[OperationService] DTO recibido:', JSON.stringify(updateOperationDto, null, 2));

      // Verify operation exists
      const validate = await this.findOne(id);
      if (validate['status'] === 404) {
        return validate;
      }

      // Validate inCharged IDs
      const validationResult =
        await this.relationService.validateInChargedIds(updateOperationDto);
      if (validationResult) return validationResult;

      // Extract data for update
      const {
        workers,
        inCharged,
        groups,
        dateStart,
        dateEnd,
        timeStrat,
        timeEnd,

        ...directFields
      } = updateOperationDto;

      // ✅ VERIFICAR SI LA OPERACIÓN ESTÁ COMPLETADA ANTES DE PROCESAR TRABAJADORES
      const currentOperation = await this.prisma.operation.findUnique({
        where: { id },
        select: { status: true, dateStart: true, timeStrat: true, dateEnd: true },
      });


      const isCompletedOperation = currentOperation?.status === 'COMPLETED';

      // Fecha/hora de inicio "efectiva" para las validaciones de SUPERVISOR: la que
      // viene en este guardado si el usuario la está cambiando, o si no la actual en BD.
      const effectiveDateStart = dateStart ?? currentOperation?.dateStart ?? undefined;
      const effectiveTimeStrat = timeStrat ?? currentOperation?.timeStrat ?? undefined;
      const effectiveDateEnd = dateEnd ?? currentOperation?.dateEnd ?? undefined;

      // Iniciar (status -> INPROGRESS) no tiene restricción alguna para SUPERVISOR.
      // Completar (status -> COMPLETED) se rige por HORAS_REGISTRO_OPERACIONES (horas
      // desde dateStart+timeStrat). SEMANAS_COMPLETAR_OPERACIONES solo debe aplicar
      // cuando el guardado realmente reprograma la operación (trae dateStart en el
      // payload) — el flujo de "Completar" grupo por grupo (submitGroupHandler /
      // groupCompletionForm) guarda dateEnd/timeEnd/facturación por grupo sin tocar el
      // dateStart de nivel operación ni el status, así que NO debe quedar atrapado por
      // esta restricción de reprogramación.
      if (directFields.status === StatusOperation.COMPLETED) {
        const hoursLimitError = await this.validateHoursLimitForCompleteOrDelete(
          !!isSupervisor,
          effectiveDateStart,
          effectiveTimeStrat,
          effectiveDateEnd,
        );
        if (hoursLimitError) return hoursLimitError;
      } else if (
        directFields.status !== StatusOperation.INPROGRESS &&
        dateStart !== undefined
      ) {
        const weeksLimitError = await this.validateWeeksLimitForEdit(
          !!isSupervisor,
          effectiveDateStart,
        );
        if (weeksLimitError) return weeksLimitError;
      }

      // ✅ Si la operación estaba RECHAZADA y este guardado trae un cambio de
      // servicio (id_tariff) para algún grupo, las facturas generadas antes del
      // rechazo ya no son válidas (la unidad de medida pudo cambiar, p. ej.
      // JORNAL -> HORAS). Se eliminan TODAS (Bill + BillDetail) de la operación de
      // una vez, para que el flujo de "Completar" vuelva a pedir los datos de cada
      // grupo desde cero.
      //
      // OJO: esto solo debe ocurrir en el guardado PRINCIPAL de edición (el que
      // envía id_tariff por grupo desde AddOperationDialog), NO en cada envío
      // individual del paso a paso de "Completar" (ese solo manda dateEnd/timeEnd,
      // sin id_tariff). Si se disparara en cada paso, la Bill recién creada del
      // grupo 1 se borraría al enviar el grupo 2, dejando el conteo de
      // "grupos ya facturados" (areAllGroupsCompleted) siempre incompleto y la
      // operación en un bucle infinito pidiendo Completar sin avanzar nunca.
      const updateIncludesServiceChange = Array.isArray(workers?.update)
        ? workers.update.some(
            (w: any) => w?.id_tariff !== undefined && w?.id_tariff !== null,
          )
        : false;

      if (currentOperation?.status === 'REJECTED' && updateIncludesServiceChange) {
        const staleBills = await this.prisma.bill.findMany({
          where: { id_operation: id },
          select: { id: true },
        });

        if (staleBills.length > 0) {
          const staleBillIds = staleBills.map((b) => b.id);
          console.log(
            `[OperationService] 🧹 Operación ${id} reenviada desde RECHAZADA: eliminando ${staleBillIds.length} factura(s) previa(s)`,
          );
          await this.prisma.$transaction([
            this.prisma.billDetail.deleteMany({ where: { id_bill: { in: staleBillIds } } }),
            this.prisma.bill.deleteMany({ where: { id: { in: staleBillIds } } }),
          ]);
        }
      }

      // Process workers
      if (workers) {
        // console.log('[OperationService] Procesando workers con nuevo flujo V2');

        // ✅ SI ES OPERACIÓN COMPLETADA Y HAY CAMBIOS EN TRABAJADORES, RECALCULAR FACTURA
        if (isCompletedOperation) {
          console.log('[OperationService] 🔄 Operación COMPLETED detectada, procesando cambios en trabajadores...');
          await this.processWorkersOperationsV2(id, workers, true); // ✅ Pasar flag isCompleted

          // Buscar y recalcular factura
          try {
            const bill = await this.prisma.bill.findFirst({
              where: { id_operation: id },
            });

            if (bill) {
              console.log(`[OperationService] 📄 Factura encontrada (ID: ${bill.id}), recalculando por cambios en trabajadores...`);

              // Importar dinámicamente BillService para evitar dependencia circular
              const { BillService } = await import('../bill/bill.service');
              const billService = this.moduleRef.get(BillService, { strict: false });

              // Recalcular la factura por cambios en trabajadores
              await billService.recalculateBillAfterOpDurationChange(bill.id, id);

              // console.log(`[OperationService] ✅ Factura ${bill.id} recalculada por cambios en trabajadores`);
            }
            // else {
            //   console.log('[OperationService] ⚠️ No se encontró factura para esta operación completada');
            // }
          } catch (error) {
            console.error('[OperationService] ❌ Error recalculando factura por cambios en trabajadores:', (error as Error).message);
            // No lanzar error para no bloquear la actualización de la operación
          }
        } else {
          // Operación no completada, proceso normal
          await this.processWorkersOperationsV2(id, workers);
        }
      }


      // ✅ PROCESAR GRUPOS (FINALIZACIÓN DE GRUPOS)
      if (groups && Array.isArray(groups) && groups.length > 0) {
        // console.log('[OperationService] Procesando finalización de grupos:', groups);
        await this.processGroupsCompletion(id, groups);
      }

      // Process inCharged
      if (inCharged) {
        // console.log('[OperationService] Procesando inCharged directamente');
        await this.processInChargedOperations(id, inCharged);
      }

      // ✅ Si se actualizaron trabajadores o se finalizó algún grupo, el fin
      // real de la operación es el máximo dateEnd/timeEnd entre TODOS los
      // grupos (Operation_Worker), no lo que venga (o no) a nivel raíz del
      // DTO. Sin esto, cuando el root no manda dateEnd/timeEnd (como en el
      // flujo de finalización de grupos), el campo queda vacío/null en vez
      // de reflejar el fin más tardío real; y si un grupo anterior ya lo
      // había fijado, un grupo que termina después no lo actualiza.
      let computedDateEnd: string | undefined;
      let computedTimeEnd: string | undefined;
      if (workers || (groups && Array.isArray(groups) && groups.length > 0)) {
        const latestEnd = await this.getLatestGroupEndDateTime(id);
        if (latestEnd) {
          computedDateEnd = latestEnd.date.toISOString();
          computedTimeEnd = latestEnd.time;
        }
      }

      // ✅ PASAR TODOS LOS PARÁMETROS DE FECHA/HORA AL MÉTODO
      // (el valor explícito del DTO tiene prioridad; si no viene, se usa el
      // fin real calculado a partir de los trabajadores/grupos)
      const operationUpdateData = this.prepareOperationUpdateData(
        directFields,
        dateStart,
        dateEnd ?? computedDateEnd,
        timeStrat,
        timeEnd ?? computedTimeEnd, // ✅ ASEGURAR QUE SE PASE timeEnd
      );

      //   SI INTENTAN COMPLETAR UNA OPERACIÓN ESPECIAL,
      // EN LUGAR DE COMPLETED DEBE PASAR A TO_APPROVED
      if (operationUpdateData.status === StatusOperation.COMPLETED) {
        const isSpecial = await this.isOperationSpecial(id);

        if (isSpecial) {
          operationUpdateData.status = StatusOperation.TO_APPROVED;

          await this.createConfirmation(id);
        }
      }

      // Update operation
      if (Object.keys(operationUpdateData).length > 0) {
        console.log('[OperationService] Actualizando datos básicos de la operación');
        console.log('[OperationService] Datos a actualizar:', operationUpdateData);


        console.log("OPERATION UPDATE DATA");
        // console.log(JSON.stringify(operationUpdateData, null, 2));
        await this.prisma.operation.update({
          where: { id },
          data: operationUpdateData,
        });
      }

      // 🔔 DESPERTAR SISTEMA: si esta edición reprograma dateStart/timeStrat de una
      // operación (p. ej. editar fechas desde la Bill), el cron de PENDING→INPROGRESS
      // podría estar en modo sueño profundo y no revisar de nuevo hasta 30 minutos
      // después. Lo despertamos aquí para que la próxima corrida (máx. 15 min) la
      // procese en vivo en lugar de quedar atascada hasta el próximo ciclo de sueño.
      if (dateStart || timeStrat) {
        try {
          const { UpdateOperationService } = await import('../cron-job/services/update-operation.service');
          const updateOperationService = this.moduleRef.get(UpdateOperationService, { strict: false });
          updateOperationService.wakeUpFromDeepSleep(`Operación reprogramada (ID: ${id})`);
        } catch (error) {
          console.warn('[OperationService] ⚠️ No se pudo despertar el sistema automático:', (error as Error).message);
        }
      }

      // ✅ RECALCULAR op_duration siempre que haya cambios en fechas u horas
      const hasDateTimeChanges = dateStart || dateEnd || timeStrat || timeEnd;


      if (hasDateTimeChanges) {
        // console.log('[OperationService] 🔄 Detectados cambios en fechas/horas, recalculando op_duration...');

        // Obtener la operación actualizada con todas las fechas
        const updatedOp = await this.prisma.operation.findUnique({
          where: { id },
          select: { dateStart: true, timeStrat: true, dateEnd: true, timeEnd: true, status: true, op_duration: true },
        });

        if (updatedOp && updatedOp.dateStart && updatedOp.timeStrat && updatedOp.dateEnd && updatedOp.timeEnd) {
          const oldOpDuration = updatedOp.op_duration;
          const newOpDuration = this.calculateOperationDuration(
            updatedOp.dateStart,
            updatedOp.timeStrat,
            updatedOp.dateEnd,
            updatedOp.timeEnd,
          );
          await this.prisma.operation.update({
            where: { id },
            data: { op_duration: newOpDuration },
          });

          // console.log(`[OperationService] ✅ op_duration actualizado en BD: ${oldOpDuration} → ${newOpDuration} horas (status: ${updatedOp.status})`);

          // ✅ SI LA OPERACIÓN ESTÁ COMPLETED Y CAMBIÓ op_duration, RECALCULAR FACTURA
          if (updatedOp.status === 'COMPLETED' && oldOpDuration !== newOpDuration) {
            // console.log('[OperationService] 🔄 Operación COMPLETED con cambio de duración, buscando factura...');

            try {
              // Buscar la factura de esta operación
              const bill = await this.prisma.bill.findFirst({
                where: { id_operation: id },
              });

              if (bill) {
                // console.log(`[OperationService] 📄 Factura encontrada (ID: ${bill.id}), recalculando compensatorio...`);

                // Importar dinámicamente BillService para evitar dependencia circular
                const { BillService } = await import('../bill/bill.service');
                const billService = this.moduleRef.get(BillService, { strict: false });

                // Recalcular la factura completa
                await billService.recalculateBillAfterOpDurationChange(bill.id, id);

                // console.log(`[OperationService] ✅ Factura ${bill.id} recalculada con nuevo compensatorio`);
              }
              // else {
              //   console.log('[OperationService] ⚠️ No se encontró factura para esta operación');
              // }
            } catch (error) {
              console.error('[OperationService] ❌ Error recalculando factura:', (error as Error).message);
              // No lanzar error para no bloquear la actualización de la operación
            }
          }
        }
      }
      // else {
      //   console.log('[OperationService] ℹ️ No se detectaron cambios en fechas/horas, no se recalcula op_duration');
      // }

      // Handle status change
      if (
        directFields.status === StatusOperation.COMPLETED &&
        operationUpdateData.status === StatusOperation.COMPLETED
      ) {
        // Ya no necesitamos calcular op_duration aquí porque se calcula arriba cuando hay cambios de fecha
        // O ya está calculado desde antes

        // ✅ CAMBIAR EL ORDEN: PRIMERO ACTUALIZAR FECHAS, LUEGO CALCULAR HORAS
        await this.operationWorkerService.completeClientProgramming(id);
        await this.operationWorkerService.releaseAllWorkersFromOperation(id);
        await this.workerService.addWorkedHoursOnOperationEnd(id);
      }
      // Get updated operation
      const updatedOperation = await this.findOne(id);
      console.log('[OperationService] Operación actualizada exitosamente');
      return updatedOperation;
    } catch (error) {
      console.error('Error updating operation:', (error as Error).message);
      throw new Error((error as Error).message);
    }


  }

  /**
   * Prepara los datos para actualizar una operación
   * @param directFields - Campos directos a actualizar
   * @param dateStart - Fecha de inicio
   * @param dateEnd - Fecha de fin
   * @param timeStrat - Hora de inicio
   * @param timeEnd - Hora de fin
   * @param observation - Observación del trabajo
   * @returns Objeto con datos preparados para actualizar
   */
  private prepareOperationUpdateData(
    directFields: any,
    dateStart?: string,
    dateEnd?: string,
    timeStrat?: string,
    timeEnd?: string,
    observation?: string,
  ) {
    const updateData = { ...directFields };

    // Eliminar campos que NO pertenecen a la tabla Operation
    delete updateData.workers;      // Este es del DTO, no de la tabla
    delete updateData.inCharged;    // Este es del DTO, no de la tabla
    delete updateData.workerIds;    // Este es del DTO, no de la tabla
    delete updateData.inChargedIds; // Este es del DTO, no de la tabla
    delete updateData.groups;       // Este es del DTO, no de la tabla
    delete updateData.removedWorkerIds; // Este es del DTO, no de la tabla
    delete updateData.originalWorkerIds; // Este es del DTO, no de la tabla
    delete updateData.updatedGroups; // Este es del DTO, no de la tabla
    delete updateData.id_tariff;    //  NO EXISTE EN Operation - viene de worker/grupo
    delete updateData.id_subtask;   //  NO EXISTE EN Operation - viene de worker/grupo
    delete updateData.id_task_worker; //  NO EXISTE EN Operation - viene de worker/grupo

    // MANTENER solo los campos que SÍ existen en la tabla Operation según el schema:
    // - status, zone, motorShip, dateStart, dateEnd, timeStrat, timeEnd
    // - createAt, updateAt, op_duration
    // - id_area, id_client, id_clientProgramming, id_user, id_task, id_site, id_subsite

    // console.log('[OperationService] Campos después de limpieza:', Object.keys(updateData));

    // ✅ id_zone: 0 no existe en el catálogo de zonas (no es obligatorio tener zona) -> guardar null
    if ('id_zone' in updateData && !updateData.id_zone) {
      updateData.id_zone = null;
    }

    if (observation) updateData.observation = observation;
    // ✅ PROCESAR FECHAS Y HORAS RESPETANDO LO QUE ENVÍA EL USUARIO
    if (dateStart) updateData.dateStart = new Date(dateStart);

    // ✅ MANEJAR FECHA DE FIN
    if (dateEnd) {
      updateData.dateEnd = new Date(dateEnd);
    } else if (updateData.status === StatusOperation.COMPLETED && !dateEnd) {
      // Solo establecer fecha actual si el usuario NO envió dateEnd
      updateData.dateEnd = new Date();
    }

    // ✅ MANEJAR HORA DE INICIO
    if (timeStrat) updateData.timeStrat = timeStrat;

    // ✅ MANEJAR HORA DE FIN - RESPETAR LA HORA DEL USUARIO
    if (timeEnd) {
      // ✅ SI EL USUARIO ENVÍA timeEnd, USARLA SIEMPRE
      updateData.timeEnd = timeEnd;
      // console.log(`[OperationService] Usando hora de fin enviada por el usuario: ${timeEnd}`);
    } else if (updateData.status === StatusOperation.COMPLETED) {
      // ✅ SOLO SI NO VIENE timeEnd Y SE ESTÁ COMPLETANDO, USAR HORA ACTUAL
      const now = new Date();
      const hh = now.getHours().toString().padStart(2, '0');
      const mm = now.getMinutes().toString().padStart(2, '0');
      updateData.timeEnd = `${hh}:${mm}`;
      // console.log(`[OperationService] No se recibió timeEnd, usando hora actual: ${updateData.timeEnd}`);
    }

    // console.log('[OperationService] Datos finales para actualizar Operation:', updateData);
    return updateData;
  }
  /**
 * Elimina un grupo específico de una operación
 * @param id - ID de la operación
 * @param id_group - ID del grupo a eliminar
 * @param userId - ID del usuario que realiza la eliminación
 * @returns Resultado de la eliminación
 */
async removeGroup(
  id: number,
  id_group: string,
  id_site?: number,
  id_subsite?: number,
  userId?: number,
) {
  try {
    // Validar operación
    const validateOperation = await this.findOne(id);

    if (validateOperation['status'] === 404) {
      return validateOperation;
    }

    if (
      id_site !== undefined &&
      validateOperation.id_site !== id_site
    ) {
      return {
        message: 'Site does not match',
        status: 400,
      };
    }

    if (
      id_subsite !== undefined &&
      validateOperation.id_subsite !== id_subsite
    ) {
      return {
        message: 'Subsite does not match',
        status: 400,
      };
    }
    
    // Iniciar transacción
    return await this.prisma.$transaction(async (tx) => {
      // Buscar Bill del grupo
      const bill = await tx.bill.findFirst({
        where: {
          id_operation: id,
          id_group: id_group,
        },
        select: {
          id: true,
        },
      });
      // Obtener trabajadores del grupo
      const workersInGroup = await tx.operation_Worker.findMany({
        where: {
          id_operation: id,
          id_group: id_group,
        },
        select: {
          id: true,
          id_worker: true,
        },
      });

      const workerIds = workersInGroup.map(
        worker => worker.id_worker,
      );
      // Eliminar BillDetail
      if (bill) {

        await tx.billDetail.deleteMany({
          where: {
            id_bill: bill.id,
          },
        });

      }
      // Eliminar Bill
      if (bill) {

        await tx.bill.delete({
          where: {
            id: bill.id,
          },
        });

      }
      // Eliminar WorkerFeeding
      if (workerIds.length > 0) {

        await tx.workerFeeding.deleteMany({
          where: {
            id_operation: id,
            id_worker: {
              in: workerIds,
            },
          },
        });

      }
      // Eliminar Operation_Worker
     const deletedWorkers =
        await tx.operation_Worker.deleteMany({
          where: {
            id_operation: id,
            id_group: id_group,
          },
        });
      // Eliminar OperationGroup
      await tx.operationGroup.deleteMany({
        where: {
          id_operation: id,
          id_group: id_group,
        },
      });
      // Liberar trabajadores
      for (const workerId of workerIds) {

        const remainingAssignments =
          await tx.operation_Worker.count({
            where: {
              id_worker: workerId,
            },
          });

        if (remainingAssignments === 0) {

          await tx.worker.update({
            where: {
              id: workerId,
            },
            data: {
              status: 'AVALIABLE',
            },
          });

        }

      }
      return {
        message: 'Grupo eliminado exitosamente.',
        deletedWorkers: deletedWorkers.count,
        id_group,
      };

    });

  } catch (error) {
    console.error(
      '[OperationService] Error eliminando grupo:',
      (error as Error).message,
    );

    throw new Error((error as Error).message);
  }
}

  /**
   * Elimina una operación por su ID o un grupo específico
   * @param id - ID de la operación a eliminar
   * @param id_group - ID del grupo a eliminar (opcional)
   * @param userId - ID del usuario que realiza la eliminación
   * @returns Operación eliminada o información de grupos disponibles
   */
async remove(
  id: number,
  id_site?: number,
  id_subsite?: number,
  id_group?: string,
  userId?: number,
  confirmDelete = false,
  isSupervisor?: boolean,
) {
  try {
    const validateOperation = await this.findOne(id);

    if (validateOperation['status'] === 404) {
      return validateOperation;
    }

    // HORAS_REGISTRO_OPERACIONES: eliminar un grupo/operación se rige igual que
    // completar (semana actual + horas desde dateStart+timeStrat).
    const hoursLimitError = await this.validateHoursLimitForCompleteOrDelete(
      !!isSupervisor,
      validateOperation.dateStart,
      validateOperation.timeStrat,
      validateOperation.dateEnd,
    );
    if (hoursLimitError) return hoursLimitError;

    if (
      id_site !== undefined &&
      validateOperation.id_site !== id_site
    ) {
      return {
        status: 400,
        message: 'Site does not match',
      };
    }

    if (
      id_subsite !== undefined &&
      validateOperation.id_subsite !== id_subsite
    ) {
      return {
        status: 400,
        message: 'Subsite does not match',
      };
    }

    if (!id_group) {
      return {
        status: 400,
        message: 'id_group es obligatorio.',
      };
    }

    // Obtener grupos de la operación
    const groups = await this.prisma.operation_Worker.findMany({
      where: { id_operation: id },
      select: { id_group: true },
      distinct: ['id_group'],
    });

    // Solo existe un grupo -> eliminar TODA la operación
    if (groups.length === 1) {

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      const isCompletedOperation =
        validateOperation.status === StatusOperation.COMPLETED;

      const allowedRoles: Role[] = isCompletedOperation
        ? [Role.ADMIN, Role.SUPERADMIN]
        : [Role.ADMIN, Role.SUPERADMIN, Role.SUPERVISOR, Role.PROGRAMMER];

      if (!user || !allowedRoles.includes(user.role)) {
        return {
          status: 403,
          message: isCompletedOperation
            ? 'Solo ADMIN y SUPERADMIN pueden eliminar una operación finalizada.'
            : 'No tienes permisos para eliminar esta operación.',
        };
      }

      const response =  await this.removeOperationCompletely(
        id,
        id_site,
        id_subsite,
        confirmDelete,
      );
      return response;
    }

    // Hay varios grupos -> eliminar únicamente el grupo solicitado
    return await this.removeGroup(
      id,
      id_group,
      id_site,
      id_subsite,
      userId,
    );
  } catch (error) {
    throw new Error((error as Error).message);
  }
}
  /**
   * Elimina múltiples grupos de una operación
   * @param id - ID de la operación
   * @param id_groups - Array de IDs de grupos a eliminar
   * @param id_site - ID del sitio
   * @param id_subsite - ID del sub-sitio
   * @param userId - ID del usuario que realiza la eliminación
   * @returns Resultado de la eliminación múltiple
   */
async removeMultipleGroups(
  id: number,
  id_groups: string[],
  id_site?: number,
  id_subsite?: number,
  userId?: number,
  confirmDelete = false,
  isSupervisor?: boolean,
) {
  try {
    const results = {
      success: [] as Array<{
        id_group: string;
        deletedWorkers: number;
        operationDeleted?: boolean;
      }>,
      failed: [] as Array<{
        id_group: string;
        reason: string;
        status: number;
      }>,
      totalRequested: id_groups.length,
    };

    let operationDeleted = false;

    for (const id_group of id_groups) {
      try {
        const result = await this.remove(
          id,
          id_site,
          id_subsite,
          id_group,
          userId,
           confirmDelete,
          isSupervisor,
        );

        if (
          result['status'] === 400 ||
          result['status'] === 403 ||
          result['status'] === 404
        ) {
          results.failed.push({
            id_group,
            reason: result['message'],
            status: result['status'],
          });

          continue;
        }

        results.success.push({
          id_group,
          deletedWorkers: result['deletedWorkers'] || 0,
          operationDeleted: result['operationDeleted'] || false,
        });

        // Si remove() eliminó la operación, ya no tiene sentido seguir
        if (result['operationDeleted']) {
          operationDeleted = true;
          break;
        }
      } catch (error) {
        results.failed.push({
          id_group,
          reason: (error as Error).message,
          status: 500,
        });
      }
    }

    if (results.failed.length === 0) {
      return {
        status: 200,
        message: operationDeleted
          ? 'Se eliminaron los grupos y la operación completa.'
          : `Se eliminaron ${results.success.length} grupo(s).`,
        results,
        operationDeleted,
      };
    }

    if (results.success.length === 0) {
      return {
        status: 400,
        message: 'No se pudo eliminar ningún grupo.',
        results,
        operationDeleted: false,
      };
    }

    return {
      status: 207,
      message: operationDeleted
        ? 'Se eliminaron algunos grupos y posteriormente la operación completa.'
        : 'Algunos grupos fueron eliminados y otros fallaron.',
      results,
      operationDeleted,
    };
  } catch (error) {
    return {
      status: 500,
      message: (error as Error).message,
    };
  }
}

 /* Elimina completamente una operación (método auxiliar)
 * @param id - ID de la operación a eliminar
 * @returns Operación eliminada
 */
private async removeOperationCompletely(
  id: number,
  id_site?: number,
  id_subsite?: number,
  confirmDelete = false,
) {
  try {
    const validateOperation = await this.findOne(id);

    if (validateOperation['status'] === 404) {
      return validateOperation;
    }

    if (
      id_site !== undefined &&
      validateOperation.id_site !== id_site
    ) {
      return {
        message: 'Site does not match',
        status: 400,
      };
    }

    if (
      id_subsite !== undefined &&
      validateOperation.id_subsite !== id_subsite
    ) {
      return {
        message: 'Subsite does not match',
        status: 400,
      };
    }

    const feedingCount =
    await this.prisma.workerFeeding.count({
        where: {
            id_operation: id,
        },
    });

if (feedingCount > 0 && !confirmDelete) {

    return {
        status: 409,
        requireConfirmation: true,
        feedingCount,
        message:
            `La operación tiene ${feedingCount} registro(s) de alimentación. ` +
            `Si continúa, dichos registros también serán eliminados. ` +
            `¿Desea continuar?`,
    };

}

    return await this.prisma.$transaction(async (tx) => {

      // ==========================================
      // Obtener trabajadores para liberarlos luego
      // ==========================================

      const workers = await tx.operation_Worker.findMany({
        where: {
          id_operation: id,
        },
        select: {
          id_worker: true,
        },
      });

      const workerIds = [...new Set(workers.map(w => w.id_worker))];

      // ==========================================
      // Buscar Bills
      // ==========================================

      const bills = await tx.bill.findMany({
        where: {
          id_operation: id,
        },
        select: {
          id: true,
        },
      });

      const billIds = bills.map(b => b.id);

      // ==========================================
      // BillDetail
      // ==========================================

      if (billIds.length > 0) {
        await tx.billDetail.deleteMany({
          where: {
            id_bill: {
              in: billIds,
            },
          },
        });
      }

      // ==========================================
      // Bill
      // ==========================================

      await tx.bill.deleteMany({
        where: {
          id_operation: id,
        },
      });

      // ==========================================
      // Token
      // OperationConfirmation
      // ==========================================

      const confirmation =
        await tx.operationConfirmation.findUnique({
          where: {
            id_operation: id,
          },
          select: {
            id: true,
          },
        });

      if (confirmation) {

        await tx.token.deleteMany({
          where: {
            id_confirmation: confirmation.id,
          },
        });

        await tx.operationConfirmation.delete({
          where: {
            id: confirmation.id,
          },
        });

      }

      // ==========================================
      // WorkerFeeding
      // ==========================================

      await tx.workerFeeding.deleteMany({
        where: {
          id_operation: id,
        },
      });

      // ==========================================
      // InChargeOperation
      // ==========================================

      await tx.inChargeOperation.deleteMany({
        where: {
          id_operation: id,
        },
      });

      // ==========================================
      // Operation_Worker
      // ==========================================

      await tx.operation_Worker.deleteMany({
        where: {
          id_operation: id,
        },
      });

      // ==========================================
      // OperationGroup
      // ==========================================

      await tx.operationGroup.deleteMany({
        where: {
          id_operation: id,
        },
      });

      // ==========================================
      // Liberar trabajadores
      // ==========================================

      for (const workerId of workerIds) {

        const remainingAssignments =
          await tx.operation_Worker.count({
            where: {
              id_worker: workerId,
            },
          });

        if (remainingAssignments === 0) {

          await tx.worker.update({
            where: {
              id: workerId,
            },
            data: {
              status: 'AVALIABLE',
            },
          });

        }

      }

      // ==========================================
      // Operation
      // ==========================================

      const response = await tx.operation.delete({
        where: {
          id,
        },
      });

      return {
        ...response,
        operationDeleted: true,
      };

    });

  } catch (error) {
    throw new Error((error as Error).message);
  }
}


  private async processWorkersOperationsV2(operationId: number, workersOps: any, isCompleted: boolean = false) {
    // console.log('[OperationService] Procesando operaciones de trabajadores V2:', JSON.stringify(workersOps, null, 2));

    if (isCompleted) {
      // console.log('[OperationService] 🔄 Procesando cambios en operación COMPLETADA');
    }

    // ✅ Capturar, ANTES de ejecutar los disconnects, la programación/tarifa
    // vigente de cada grupo real referenciado por un connect. Si el disconnect
    // elimina al último Operation_Worker de ese grupo (p. ej. reemplazar al
    // único trabajador de un grupo en la misma petición), el connect ya no
    // tendría de dónde heredar dateStart/timeStart/dateEnd/timeEnd/id_task/
    // id_subtask/id_tariff — quedando el grupo "vacío" de tarifa aunque su
    // id_group sobreviva.
    const groupSnapshots = new Map<string, {
      dateStart: Date | null;
      dateEnd: Date | null;
      timeStart: string | null;
      timeEnd: string | null;
      id_task: number | null;
      id_subtask: number | null;
      id_tariff: number | null;
      observation: string | null;
    }>();

    if (workersOps.connect && Array.isArray(workersOps.connect)) {
      for (const connectOp of workersOps.connect) {
        const groupId = connectOp?.groupId;
        const isTemp = typeof groupId === 'string' && groupId.startsWith('temp_');

        if (!groupId || isTemp || connectOp.isNewGroup === true || groupSnapshots.has(groupId)) {
          continue;
        }

        const existingGroupWorker = await this.prisma.operation_Worker.findFirst({
          where: { id_operation: operationId, id_group: groupId },
        });

        if (existingGroupWorker) {
          groupSnapshots.set(groupId, {
            dateStart: existingGroupWorker.dateStart,
            dateEnd: existingGroupWorker.dateEnd,
            timeStart: existingGroupWorker.timeStart,
            timeEnd: existingGroupWorker.timeEnd,
            id_task: existingGroupWorker.id_task,
            id_subtask: existingGroupWorker.id_subtask,
            id_tariff: existingGroupWorker.id_tariff,
            observation: existingGroupWorker.observation,
          });
        }
      }
    }

    // 1. DESCONECTAR/ELIMINAR TRABAJADORES (mantener igual)
    if (workersOps.disconnect && Array.isArray(workersOps.disconnect) && workersOps.disconnect.length > 0) {
      // console.log('[OperationService] Eliminando trabajadores:', workersOps.disconnect);

      for (const disconnectOp of workersOps.disconnect) {
        // console.log('[OperationService] Procesando eliminación individual:', disconnectOp);

        if (!disconnectOp.id || isNaN(Number(disconnectOp.id))) {
          console.error('[OperationService] ID de trabajador inválido:', disconnectOp.id);
          throw new BadRequestException(`ID de trabajador inválido: ${disconnectOp.id}`);
        }

        const workerId = Number(disconnectOp.id);
        // console.log('[OperationService] ID de trabajador convertido a número:', workerId);

        try {
          if (disconnectOp.id_group) {
            // console.log('[OperationService] Eliminando trabajador del grupo específico');
            const removeResult = await this.removeWorkerService.removeWorkerFromGroup(
              operationId,
              workerId,
              disconnectOp.id_group
            );
            // console.log('[OperationService] Trabajador eliminado del grupo:', removeResult);
          } else {
            // console.log('[OperationService] Eliminando trabajador de toda la operación');
            const removeResult = await this.removeWorkerService.removeWorkerFromOperation(
              operationId,
              workerId
            );
            // console.log('[OperationService] Trabajador eliminado de la operación:', removeResult);
          }
        } catch (error) {
          console.error('[OperationService] Error eliminando trabajador:', error);
          throw error;
        }
      }
    }

    // 2. CONECTAR/AGREGAR NUEVOS TRABAJADORES - ✅ CORREGIR AQUÍ
    // if (workersOps.connect && workersOps.connect.length > 0) {
    //   console.log('[OperationService] Agregando trabajadores:', workersOps.connect);

    //   for (const connectOp of workersOps.connect) {
    //     console.log('[OperationService] Procesando conexión:', connectOp);

    //     // ✅ VERIFICAR QUE workerIds EXISTE Y ES UN ARRAY
    //     if (!connectOp.workerIds || !Array.isArray(connectOp.workerIds)) {
    //       console.error('[OperationService] workerIds no encontrado o no es array:', connectOp);
    //       throw new BadRequestException('workerIds debe ser un array válido en la operación connect');
    //     }

    //     // ✅ PROCESAR CADA WORKER ID EN EL ARRAY
    //     // for (const workerId of connectOp.workerIds) {
    //     //   // ✅ VALIDAR QUE EL ID SEA VÁLIDO
    //     //   if (!workerId || isNaN(Number(workerId))) {
    //     //     console.error('[OperationService] ID de trabajador inválido:', workerId);
    //     //     throw new BadRequestException(`ID de trabajador inválido: ${workerId}`);
    //     //   }

    //     //   console.log(`[OperationService] Procesando trabajador ID: ${workerId}`);

    //     //   try {
    //     //     // ✅ CREAR EL OBJETO PARA ASIGNAR TRABAJADOR
    //     //     const assignData = {
    //     //       id_operation: operationId,
    //     //       id_worker: Number(workerId),
    //     //       dateStart: connectOp.dateStart || null,
    //     //       dateEnd: connectOp.dateEnd || null,
    //     //       timeStart: connectOp.timeStart || null,
    //     //       timeEnd: connectOp.timeEnd || null,
    //     //       id_task: connectOp.id_task || null,
    //     //       id_subtask: connectOp.id_subtask || null,
    //     //       id_tariff: connectOp.id_tariff || null,
    //     //     };

    //     //     console.log(`[OperationService] Datos para asignar trabajador ${workerId}:`, assignData);

    //     //     // ✅ USAR EL SERVICIO DE ASIGNACIÓN EXISTENTE
    //     //     const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
    //     //     console.log(`[OperationService] Trabajador ${workerId} asignado exitosamente:`, assignResult);
    //     //   } catch (error) {
    //     //     console.error(`[OperationService] Error asignando trabajador ${workerId}:`, error);
    //     //     throw new BadRequestException(`Error asignando trabajador ${workerId}: ${(error as Error).message}`);
    //     //   }
    //     // }
    //      try {
    //       // ✅ VERIFICAR SI ES UN NUEVO GRUPO O ASIGNACIÓN SIMPLE
    //       if (connectOp.isNewGroup) {
    //         console.log('[OperationService] Creando NUEVO GRUPO para trabajadores:', connectOp.workerIds);

    //         // ✅ USAR EL FORMATO CORRECTO PARA GRUPOS CON PROGRAMACIÓN
    //         const assignData = {
    //           id_operation: operationId,
    //           workersWithSchedule: [{
    //             workerIds: connectOp.workerIds.map(id => Number(id)),
    //             dateStart: connectOp.dateStart || null,
    //             dateEnd: connectOp.dateEnd || null,
    //             timeStart: connectOp.timeStart || null,
    //             timeEnd: connectOp.timeEnd || null,
    //             id_task: connectOp.id_task || null,
    //             id_subtask: connectOp.id_subtask || null,
    //             id_tariff: connectOp.id_tariff || null,
    //             // ✅ NO incluir id_group para que se genere uno nuevo automáticamente
    //           }]
    //         };

    //         console.log('[OperationService] Datos para crear nuevo grupo:', assignData);
    //         const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
    //         console.log('[OperationService] Nuevo grupo creado exitosamente:', assignResult);

    //       } else {
    //         console.log('[OperationService] Asignando trabajadores SIN grupo específico:', connectOp.workerIds);

    //         // ✅ ASIGNACIÓN SIMPLE (SIN GRUPO) - PROCESAR CADA TRABAJADOR INDIVIDUALMENTE
    //         for (const workerId of connectOp.workerIds) {
    //           // ✅ VALIDAR QUE EL ID SEA VÁLIDO
    //           if (!workerId || isNaN(Number(workerId))) {
    //             console.error('[OperationService] ID de trabajador inválido:', workerId);
    //             throw new BadRequestException(`ID de trabajador inválido: ${workerId}`);
    //           }

    //           console.log(`[OperationService] Procesando trabajador ID: ${workerId}`);

    //           // ✅ CREAR EL OBJETO PARA ASIGNAR TRABAJADOR SIMPLE
    //           const assignData = {
    //             id_operation: operationId,
    //             workerIds: [Number(workerId)], // ✅ Usar array de IDs para asignación simple
    //           };

    //           console.log(`[OperationService] Datos para asignar trabajador ${workerId}:`, assignData);
    //           const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
    //           console.log(`[OperationService] Trabajador ${workerId} asignado exitosamente:`, assignResult);
    //         }
    //       }
    //     } catch (error) {
    //       console.error(`[OperationService] Error procesando conexión:`, error);
    //       throw new BadRequestException(`Error procesando conexión: ${(error as Error).message}`);
    //     }
    //   }
    // }
    //------------------------------------- FUNCIONando CORRECTAMENTE DESDE AQUÍ -----------------------------
    // // 2. CONECTAR/AGREGAR NUEVOS TRABAJADORES - ✅ CORREGIR AQUÍ
    // if (workersOps.connect && workersOps.connect.length > 0) { 
    //   console.log('[OperationService] Agregando trabajadores:', workersOps.connect);

    //   for (const connectOp of workersOps.connect) {
    //     console.log('[OperationService] Procesando conexión:', connectOp);

    //     // ✅ VERIFICAR QUE workerIds EXISTE Y ES UN ARRAY
    //     if (!connectOp.workerIds || !Array.isArray(connectOp.workerIds)) {
    //       console.error('[OperationService] workerIds no encontrado o no es array:', connectOp);
    //       throw new BadRequestException('workerIds debe ser un array válido en la operación connect');
    //     }

    //     try {
    //       // ✅ VERIFICAR SI ES UN NUEVO GRUPO O ASIGNACIÓN SIMPLE
    //       if (connectOp.isNewGroup) {
    //         console.log('[OperationService] Creando NUEVO GRUPO para trabajadores:', connectOp.workerIds);

    //         // ✅ USAR EL FORMATO CORRECTO PARA GRUPOS CON PROGRAMACIÓN
    //         const assignData = {
    //           id_operation: operationId,
    //           workersWithSchedule: [{
    //             workerIds: connectOp.workerIds.map(id => Number(id)),
    //             dateStart: connectOp.dateStart,
    //             dateEnd: connectOp.dateEnd || null,
    //             timeStart: connectOp.timeStart,
    //             timeEnd: connectOp.timeEnd || null,
    //             id_task: connectOp.id_task,
    //             id_subtask: connectOp.id_subtask,
    //             id_tariff: connectOp.id_tariff,
    //           }]
    //         };

    //         console.log('[OperationService] Datos para crear nuevo grupo:', assignData);
    //         const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
    //         console.log('[OperationService] Nuevo grupo creado exitosamente:', assignResult);

    //       } else {
    //         console.log('[OperationService] Asignando trabajadores SIN grupo específico:', connectOp.workerIds);

    //         // ✅ ASIGNACIÓN SIMPLE (SIN GRUPO) - PROCESAR CADA TRABAJADOR INDIVIDUALMENTE
    //         for (const workerId of connectOp.workerIds) {
    //           // ✅ VALIDAR QUE EL ID SEA VÁLIDO
    //           if (!workerId || isNaN(Number(workerId))) {
    //             console.error('[OperationService] ID de trabajador inválido:', workerId);
    //             throw new BadRequestException(`ID de trabajador inválido: ${workerId}`);
    //           }

    //           console.log(`[OperationService] Procesando trabajador ID: ${workerId}`);

    //           // ✅ CREAR EL OBJETO PARA ASIGNAR TRABAJADOR SIMPLE
    //           const assignData = {
    //             id_operation: operationId,
    //             workerIds: [Number(workerId)], // ✅ Usar array de IDs para asignación simple
    //           };

    //           console.log(`[OperationService] Datos para asignar trabajador ${workerId}:`, assignData);
    //           const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
    //           console.log(`[OperationService] Trabajador ${workerId} asignado exitosamente:`, assignResult);
    //         }
    //       }
    //     } catch (error) {
    //       console.error(`[OperationService] Error procesando conexión:`, error);
    //       throw new BadRequestException(`Error procesando conexión: ${(error as Error).message}`);
    //     }
    //   }
    // }

    // 2. CONECTAR/AGREGAR NUEVOS TRABAJADORES
    if (workersOps.connect && workersOps.connect.length > 0) {
      // console.log('[OperationService] Agregando trabajadores:', workersOps.connect);

      for (const connectOp of workersOps.connect) {
        // console.log('[OperationService] Procesando conexión:', connectOp);

        // ✅ VERIFICAR QUE workerIds EXISTE Y ES UN ARRAY
        if (!connectOp.workerIds || !Array.isArray(connectOp.workerIds)) {
          console.error('[OperationService] workerIds no encontrado o no es array:', connectOp);
          throw new BadRequestException('workerIds debe ser un array válido en la operación connect');
        }

        // ✅ DETECTAR SI ES UN groupId TEMPORAL (MÓVIL)
        const isTemporaryGroupId = connectOp.groupId && connectOp.groupId.startsWith('temp_');
        const isNewGroup = connectOp.isNewGroup === true;
        const isRealExistingGroup = connectOp.groupId && !isTemporaryGroupId && !isNewGroup;



        try {
          if (isTemporaryGroupId && isNewGroup) {
            // ✅ CASO MÓVIL: DELEGAR A assignWorkersToOperation
            // console.log('[OperationService] 📱 MÓVIL: Delegando creación de nuevo grupo a assignWorkersToOperation');

            const assignData = {
              id_operation: operationId,
              workersWithSchedule: [{
                workerIds: connectOp.workerIds.map(id => Number(id)),
                dateStart: connectOp.dateStart,
                dateEnd: connectOp.dateEnd || null,
                timeStart: connectOp.timeStart,
                timeEnd: connectOp.timeEnd || null,
                id_task: connectOp.id_task,
                id_subtask: connectOp.id_subtask,
                id_tariff: connectOp.id_tariff,
                observation: connectOp.observation, // ✅ AGREGAR OBSERVATION
                // ✅ NO incluir id_group - Se genera automáticamente
              }]
            };

            // console.log('[OperationService] Datos para nuevo grupo (móvil):', assignData);
            const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
            // console.log('[OperationService] Nuevo grupo creado desde móvil:', assignResult);

          } else if (isRealExistingGroup) {
            // ✅ CASO: AGREGAR A GRUPO EXISTENTE REAL
            // console.log('[OperationService] 🔗 Agregando a grupo existente real:', connectOp.groupId);

            // ✅ HEREDAR VALORES DEL GRUPO EXISTENTE desde el snapshot tomado ANTES
            // de procesar los disconnects (ver arriba). Usar una consulta en vivo
            // aquí sería incorrecto si el disconnect de esta misma petición ya
            // eliminó al último Operation_Worker del grupo: ya no habría ningún
            // registro del cual heredar id_task/id_subtask/id_tariff.
            const existingGroupWorker = groupSnapshots.get(connectOp.groupId);

            const assignData = {
              id_operation: operationId,
              workersWithSchedule: [{
                workerIds: connectOp.workerIds.map(id => Number(id)),
                id_group: connectOp.groupId, // ✅ USAR GRUPO EXISTENTE
                // ✅ HEREDAR VALORES DEL GRUPO EXISTENTE
                dateStart: connectOp.dateStart ?? existingGroupWorker?.dateStart,
                dateEnd: connectOp.dateEnd ?? existingGroupWorker?.dateEnd,
                timeStart: connectOp.timeStart ?? existingGroupWorker?.timeStart,
                timeEnd: connectOp.timeEnd ?? existingGroupWorker?.timeEnd,
                id_task: connectOp.id_task ?? existingGroupWorker?.id_task,
                id_subtask: connectOp.id_subtask ?? existingGroupWorker?.id_subtask,
                id_tariff: connectOp.id_tariff ?? existingGroupWorker?.id_tariff,
                observation: connectOp.observation ?? existingGroupWorker?.observation, // ✅ AGREGAR OBSERVATION
              }]
            };

            // console.log('[OperationService] Datos para grupo existente:', assignData);
            const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
            // console.log('[OperationService] Agregado a grupo existente:', assignResult);

          } else if (isNewGroup && !isTemporaryGroupId) {
            // ✅ CASO WEB: CREAR NUEVO GRUPO SIN groupId TEMPORAL
            // console.log('[OperationService] 🌐 WEB: Creando nuevo grupo');

            const assignData = {
              id_operation: operationId,
              workersWithSchedule: [{
                workerIds: connectOp.workerIds.map(id => Number(id)),
                dateStart: connectOp.dateStart,
                dateEnd: connectOp.dateEnd || null,
                timeStart: connectOp.timeStart,
                timeEnd: connectOp.timeEnd || null,
                id_task: connectOp.id_task,
                id_subtask: connectOp.id_subtask,
                id_tariff: connectOp.id_tariff,
                observation: connectOp.observation, // ✅ AGREGAR OBSERVATION
              }]
            };

            // console.log('[OperationService] Datos para nuevo grupo (web):', assignData);
            const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
            // console.log('[OperationService] Nuevo grupo creado desde web:', assignResult);

          } else {
            // ✅ CASO: ASIGNACIÓN SIMPLE SIN GRUPO
            // console.log('[OperationService] ➕ Asignación simple sin grupo específico');

            for (const workerId of connectOp.workerIds) {
              if (!workerId || isNaN(Number(workerId))) {
                console.error('[OperationService] ID de trabajador inválido:', workerId);
                throw new BadRequestException(`ID de trabajador inválido: ${workerId}`);
              }

              const assignData = {
                id_operation: operationId,
                workerIds: [Number(workerId)],
              };

              // console.log(`[OperationService] Asignación simple trabajador ${workerId}:`, assignData);
              const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
              // console.log(`[OperationService] Trabajador ${workerId} asignado:`, assignResult);
            }
          }
        } catch (error) {
          console.error(`[OperationService] Error procesando conexión:`, (error as Error).message);
          throw new BadRequestException(`Error procesando conexión: ${(error as Error).message}`);
        }
      }
    }

    //------------------------------------- HASTA AQUÍ FUNCIONANDO CORRECTAMENTE -----------------------------

    // 3. ACTUALIZAR TRABAJADORES EXISTENTES

    //------------------------------------- FUNCIONando CORRECTAMENTE DESDE AQUÍ -----------------------------

    if (workersOps.update && workersOps.update.length > 0) {
      // console.log('[OperationService] ===== PROCESANDO UPDATE WORKERS =====');
      // console.log('[OperationService] workersOps.update:', JSON.stringify(workersOps.update, null, 2));

      const workersToUpdate = workersOps.update
        .filter(updateOp => updateOp.id_worker && !isNaN(Number(updateOp.id_worker)))
        .map((updateOp: any) => {
          const mapped = {
            id_group: updateOp.id_group,
            workerIds: [Number(updateOp.id_worker)],
            id_task: updateOp.id_task,
            id_subtask: updateOp.id_subtask, // ✅ ASEGURAR QUE SE INCLUYA
            id_tariff: updateOp.id_tariff,
            dateStart: updateOp.dateStart,
            dateEnd: updateOp.dateEnd,
            timeStart: updateOp.timeStart,
            timeEnd: updateOp.timeEnd,
            observation: updateOp.observation, // ✅ AGREGAR OBSERVATION
          };

          // console.log(`[OperationService] Worker ${updateOp.id_worker} mapeado:`, {
          //   id_task: mapped.id_task,
          //   id_subtask: mapped.id_subtask, // ✅ LOG ESPECÍFICO
          //   id_tariff: mapped.id_tariff
          // });

          return mapped;
        });

      // console.log('[OperationService] ===== WORKERS PREPARADOS PARA ACTUALIZAR =====');
      // workersToUpdate.forEach((worker, index) => {
      //   console.log(`Worker ${index + 1}:`, {
      //     id_group: worker.id_group,
      //     workerIds: worker.workerIds,
      //     id_task: worker.id_task,
      //     id_subtask: worker.id_subtask, // ✅ VERIFICAR QUE ESTÉ AQUÍ
      //     id_tariff: worker.id_tariff
      //   });
      // });

      if (workersToUpdate.length > 0) {
        try {
          const updateResult = await this.operationWorkerService.updateWorkersSchedule(
            operationId,
            workersToUpdate
          );
          // console.log('[OperationService] Resultado actualización:', updateResult);
        } catch (error) {
          console.error('[OperationService] Error actualizando trabajadores en la operación:', (error as Error).message);
          throw error;
        }
      }
    }



    //------------------------------------- HASTA AQUÍ FUNCIONANDO CORRECTAMENTE -----------------------------
  }

  /**
   * Inicializa manualmente las operaciones pendientes que ya deberían estar en progreso
   * @returns Resultado de la inicialización manual
   */
  async initializePendingOperations() {
    try {
      // console.log('[OperationService] Inicializando operaciones pendientes manualmente...');

      // Importar dinámicamente UpdateOperationService para evitar dependencia circular
      const { UpdateOperationService } = await import('../cron-job/services/update-operation.service');
      const updateOperationService = this.moduleRef.get(UpdateOperationService, { strict: false });

      const result = await updateOperationService.updateInProgressOperations();

      // console.log(`[OperationService] ✅ Resultado de inicialización manual: ${result.updatedCount} operaciones actualizadas`);

      return {
        message: `${result.updatedCount} operaciones inicializadas exitosamente`,
        updatedCount: result.updatedCount,
        status: 200
      };
    } catch (error) {
      console.error('[OperationService] ❌ Error en inicialización manual:', (error as Error).message);
      throw new Error(`Error inicializando operaciones: ${(error as Error).message}`);
    }
  }

  // **AGREGAR EL MÉTODO PARA PROCESAR ENCARGADOS**
  private async processInChargedOperations(operationId: number, inChargedOps: any) {
    // console.log('[OperationService] Procesando operaciones de encargados:', inChargedOps);

    // ✅ SIEMPRE ELIMINAR TODOS LOS ENCARGADOS EXISTENTES PRIMERO
    await this.prisma.inChargeOperation.deleteMany({
      where: { id_operation: operationId }
    });
    // console.log('[OperationService] Eliminados todos los encargados existentes para la operación:', operationId);

    // Conectar nuevos encargados (si los hay)
    if (inChargedOps.connect && inChargedOps.connect.length > 0) {
      // ✅ FILTRAR DUPLICADOS ANTES DE CREAR
      const uniqueConnections = inChargedOps.connect.filter(
        (item, index, self) => index === self.findIndex(i => i.id === item.id)
      );

      // console.log('[OperationService] Encargados únicos a conectar:', uniqueConnections);

      if (uniqueConnections.length > 0) {
        const dataToCreate = uniqueConnections.map((op: any) => ({
          id_operation: operationId,
          id_user: Number(op.id),
        }));

        try {
          const result = await this.prisma.inChargeOperation.createMany({
            data: dataToCreate,
            skipDuplicates: true,
          });
          // console.log(`[OperationService] ${result.count} encargados conectados exitosamente`);
          // console.log(`[OperationService] IDs conectados: ${uniqueConnections.map((op: any) => op.id).join(', ')}`);
        } catch (error) {
          console.error('[OperationService] Error creando encargados:', error);
          throw new BadRequestException('Error al asignar encargados a la operación');
        }
      }
    }

    // ✅ NO PROCESAR DISCONNECT PORQUE YA ELIMINAMOS TODOS AL INICIO
    // Esto simplifica la lógica y evita conflictos
  }
  /**
   * Procesa la finalización de grupos actualizando fechas y horas de finalización
   * @param operationId - ID de la operación
   * @param groups - Array de grupos con información de finalización
   */
  private async processGroupsCompletion(operationId: number, groups: any[]) {
    // console.log('[OperationService] ===== PROCESANDO FINALIZACIÓN DE GRUPOS =====');
    // console.log('[OperationService] Grupos a procesar:', JSON.stringify(groups, null, 2));

    for (const group of groups) {
      const { groupId, dateEnd, timeEnd, observation } = group;

      if (!groupId) {
        console.warn('[OperationService] Grupo sin groupId, saltando:', group);
        continue;
      }

      // console.log(`[OperationService] Procesando finalización de grupo: ${groupId}`);
      // console.log(`[OperationService] Datos de finalización: dateEnd=${dateEnd}, timeEnd=${timeEnd}, observation=${observation}`);

      try {
        // Preparar datos de actualización
        const updateData: any = {};

        if (dateEnd) {
          updateData.dateEnd = new Date(dateEnd);
          // console.log(`[OperationService] Estableciendo dateEnd: ${updateData.dateEnd}`);
        }

        if (timeEnd) {
          updateData.timeEnd = timeEnd;
          // console.log(`[OperationService] Estableciendo timeEnd: ${timeEnd}`);
        }

        if (observation !== undefined) {
          updateData.observation = observation;
          // console.log(`[OperationService] Estableciendo observation: ${observation}`);
        }

        // Solo actualizar si hay datos para actualizar
        if (Object.keys(updateData).length > 0) {
          const result = await this.prisma.operation_Worker.updateMany({
            where: {
              id_operation: operationId,
              id_group: groupId,
            },
            data: updateData,
          });

          // console.log(`[OperationService] Grupo ${groupId} finalizado. Trabajadores afectados: ${result.count}`);
        }
        // else {
        //   console.log(`[OperationService] No hay datos de finalización para grupo ${groupId}`);
        // }
      } catch (error) {
        console.error(`[OperationService] Error finalizando grupo ${groupId}:`, (error as Error).message);
        throw new BadRequestException(`Error finalizando grupo ${groupId}: ${(error as Error).message}`);
      }
    }

    // console.log('[OperationService] ===== FINALIZACIÓN DE GRUPOS COMPLETADA =====');
  }

  //   // Método para obtener operaciones por trabajador (trabajadores asignados a una operación específica)
  async findByWorker(
    idWorker: number,
    idSite?: number,
    page = 1,
    limit?: number, // <- opcional (sin límite cuando viene undefined)
    statuses: string[] = ['INPROGRESS'],
  ) {
    return this.finderService.findByWorker(idWorker, idSite, page, limit, statuses);
  }
}
