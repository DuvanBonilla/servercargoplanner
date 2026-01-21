import { Prisma } from '@prisma/client';

/**
 * Interfaz para la configuración de inclusión en consultas de operaciones
 */
export interface OperationIncludeConfig {
  client: {
    select: { 
      name: boolean 
    };
  };
  jobArea: {
    select: {
      id: boolean;
      name: boolean;
    };
  };
  // SubTask: {
  //   select: {
  //     id: boolean;
  //     name: boolean;
  //   };
  // };
  task: {
    select: {
      id: boolean;
      name: boolean;
    };
  };
  clientProgramming: {
    select: {
      service: boolean;
    };
  };
  Site: {
    select: {
      name: boolean;
    };
  };
  workers: {
    select: {
      id: boolean;
      id_worker: boolean;
      timeStart: boolean;
      timeEnd: boolean;
      dateStart: boolean;
      dateEnd: boolean;
      id_group: boolean;
      id_subtask: boolean;
      worker: {
        select: {
          id: boolean;
          name: boolean;
          dni: boolean;
        };
      };
      task: {
        select: {
          id: boolean;
          name: boolean;
        };
      };
      SubTask: { 
        select: {
          id: boolean;
          name: boolean;
          code: boolean;
        };
      };
      tariff: { 
        include: { 
          subTask: boolean,
          unitOfMeasure: boolean, 
          facturationUnit: boolean
        } 
      };
    };
  };
  inChargeOperation: {
    select: {
      id_user: boolean;
      id_operation: boolean;
      user: {
        select: {
          id: boolean;
          name: boolean;
        };
      };
    };
  };
  Bill: {
    include: {
      billDetails: {
        include: {
          operationWorker: {
            select: {
              id: boolean;
              id_worker: boolean;
              id_operation: boolean;
              dateStart: boolean;
              dateEnd: boolean;
              timeStart: boolean;
              timeEnd: boolean;
            };
          };
        };
      };
    };
  };
}

/**
 * Crea un objeto de configuración de inclusión para operaciones
 * @returns Configuración de inclusión de operaciones
 */
export function createOperationInclude(): OperationIncludeConfig {
  return {
    client: {
      select: { name: true },
    },
    jobArea: {
      select: {
        id: true,
        name: true,
      },
    },
    // SubTask: {
    //   select: {
    //     id: true,
    //     name: true,
    //   },
    // },
    task: {
      select: {
        id: true,
        name: true,
      },
    },
    clientProgramming: {
      select: {
        service: true,
      },
    },
    Site: {
      select: {
        name: true,
      },
    },
    workers: {
      select: {
        id: true,
        id_worker: true,
        timeStart: true,
        timeEnd: true,
        dateStart: true,
        dateEnd: true,
        id_group: true,
        id_subtask: true,
        worker: {
          select: {
            id: true,
            name: true,
            dni: true
          },
        },
        task: {
          select: {
            id: true,
            name: true,
          },
        },
         SubTask: { // <--- Aquí traes la subtask seleccionada por grupo
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        tariff: { include: { subTask: true, unitOfMeasure: true, facturationUnit: true } },
      },
    },
    inChargeOperation: {
      select: {
        id_user: true,
        id_operation: true,
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
    Bill: {
      include: {
        billDetails: {
          include: {
            operationWorker: {
              select: {
                id: true,
                id_worker: true,
                id_operation: true,
                dateStart: true,
                dateEnd: true,
                timeStart: true,
                timeEnd: true,
              }
            }
          }
        }
      }
    },
  };
}