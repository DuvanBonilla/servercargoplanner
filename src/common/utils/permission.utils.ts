import { getColombianDateTime } from "./dateColombia";
/**
   * Compara si un permiso está vigente considerando fecha + hora EN ZONA COLOMBIA
   * VIGENTE = AHORA (Colombia time) está entre dateDisableStart+timeStart y dateDisableEnd+timeEnd (inclusive)
   */
export function isPermissionActive(
  permission: any,
): boolean {
    //   console.trace('isPermissionActive');

    const now = getColombianDateTime(); // NOW en zona Colombia 
    
    // Extraer YYYY-MM-DD de las fechas
    let startY: number, startM: number, startD: number;
    let endY: number, endM: number, endD: number;

    try {
      let startDateStr: string;
      if (permission.dateDisableStart instanceof Date) {
        startDateStr = permission.dateDisableStart.toISOString().slice(0, 10);
      } else {
        startDateStr = String(permission.dateDisableStart).slice(0, 10);
      }
      const startParts = startDateStr.split('-').map(Number);
      startY = startParts[0];
      startM = startParts[1];
      startD = startParts[2];

      let endDateStr: string;
      if (permission.dateDisableEnd instanceof Date) {
        endDateStr = permission.dateDisableEnd.toISOString().slice(0, 10);
      } else {
        endDateStr = String(permission.dateDisableEnd).slice(0, 10);
      }
      const endParts = endDateStr.split('-').map(Number);
      endY = endParts[0];
      endM = endParts[1];
      endD = endParts[2];
    } catch (err) {
      console.error(`[PermissionService] Error parsing dates:`, err);
      return false;
    }

    // Construir el datetime de INICIO usando el MISMO método que getColombianDateTime()
    const timeStartStr = permission.timeStart || '00:00';
    const [hhStart, mmStart] = timeStartStr.split(':').map(Number);
    
    const tempStartDateTime = new Date(startY, startM - 1, startD, hhStart, mmStart, 0, 0);
   const startDateTime = tempStartDateTime;

    // Construir el datetime de FIN usando el MISMO método
    const timeEndStr = permission.timeEnd || '23:59';
    const [hhEnd, mmEnd] = timeEndStr.split(':').map(Number);
    
    const tempEndDateTime = new Date(endY, endM - 1, endD, hhEnd, mmEnd, 59, 999);
    const endDateTime = tempEndDateTime;
    // const endDateTime = new Date(
    //   tempEndDateTime.toLocaleString('en-US', { timeZone: 'America/Bogota' }),
    // );

    // VIGENTE si: inicio <= ahora <= fin (todos en zona Colombia)
    const isActive = startDateTime <= now && now <= endDateTime;
    
    // Debug
    // console.log(`[PermissionService] DEBUG isPermissionActive:`);
    // // console.log(`  - Inicio: ${startDateTime.toLocaleString('sv-SE')} (Colombia)`);
    // console.log(`  - Fin: ${endDateTime.toLocaleString('sv-SE')} (Colombia)`);
    // console.log(`  - Ahora: ${now.toLocaleString('sv-SE')} (Colombia)`);
    // console.log(`  - ¿${startDateTime.toLocaleString('sv-SE')} <= ${now.toLocaleString('sv-SE')} <= ${endDateTime.toLocaleString('sv-SE')}? ${isActive}`);
    
    return isActive;
  }

