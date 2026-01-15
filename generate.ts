const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const marked = require('marked');

// Verificar si marked está instalado, de lo contrario instalarlo
try {
  require.resolve('marked');
} catch (e) {
  console.log('Instalando dependencia marked...');
  execSync('npm install --save-dev marked');
  console.log('✓ Marked instalado');
}

const resources = [
  'area',
  'user',
  'worker',
  'operation',
  'client',
  'task',
  'auth',
  'common',
  'cron-job',
  'prisma',
];

// Descripción breve de cada módulo
const moduleDescriptions = {
  area: {
    title: 'Gestión de Áreas',
    description:
      'Este módulo gestiona las áreas o departamentos de la organización. Permite crear, actualizar, eliminar y consultar información sobre las diferentes áreas operativas.',
    features: [
      'Creación y administración de áreas',
      'Asignación de trabajadores a áreas',
      'Reportes y estadísticas por área',
    ],
    endpoints: [
      { method: 'GET', path: '/area', description: 'Obtiene todas las áreas' },
      {
        method: 'GET',
        path: '/area/:id',
        description: 'Obtiene un área por ID',
      },
      { method: 'POST', path: '/area', description: 'Crea una nueva área' },
      {
        method: 'PATCH',
        path: '/area/:id',
        description: 'Actualiza un área existente',
      },
      { method: 'DELETE', path: '/area/:id', description: 'Elimina un área' },
    ],
  },
  user: {
    title: 'Gestión de Usuarios',
    description:
      'Administración de usuarios del sistema con diferentes roles y permisos. Maneja la autenticación y autorización de los usuarios.',
    features: [
      'Registro y autenticación de usuarios',
      'Gestión de roles y permisos',
      'Recuperación y cambio de contraseña',
    ],
    endpoints: [
      {
        method: 'GET',
        path: '/user',
        description: 'Obtiene todos los usuarios',
      },
      {
        method: 'GET',
        path: '/user/:id',
        description: 'Obtiene un usuario por ID',
      },
      { method: 'POST', path: '/user', description: 'Crea un nuevo usuario' },
      {
        method: 'PATCH',
        path: '/user/:id',
        description: 'Actualiza un usuario existente',
      },
      {
        method: 'DELETE',
        path: '/user/:id',
        description: 'Elimina un usuario',
      },
    ],
  },
  worker: {
    title: 'Gestión de Trabajadores',
    description:
      'Este módulo permite administrar la información de los trabajadores de la organización, incluyendo sus datos personales y asignaciones.',
    features: [
      'Registro completo de información de trabajadores',
      'Asignación a operaciones y áreas',
      'Seguimiento de horas trabajadas',
    ],
    endpoints: [
      {
        method: 'GET',
        path: '/worker',
        description: 'Obtiene todos los trabajadores',
      },
      {
        method: 'GET',
        path: '/worker/:id',
        description: 'Obtiene un trabajador por ID',
      },
      {
        method: 'POST',
        path: '/worker',
        description: 'Crea un nuevo trabajador',
      },
      {
        method: 'PATCH',
        path: '/worker/:id',
        description: 'Actualiza un trabajador existente',
      },
      {
        method: 'DELETE',
        path: '/worker/:id',
        description: 'Elimina un trabajador',
      },
    ],
  },
  operation: {
    title: 'Gestión de Operaciones',
    description:
      'Control y seguimiento de las operaciones o proyectos en curso. Administra el ciclo de vida completo de cada operación.',
    features: [
      'Creación y planificación de operaciones',
      'Asignación de recursos y personal',
      'Seguimiento del progreso y estado de operaciones',
    ],
    endpoints: [
      {
        method: 'GET',
        path: '/operation',
        description: 'Obtiene todas las operaciones',
      },
      {
        method: 'GET',
        path: '/operation/:id',
        description: 'Obtiene una operación por ID',
      },
      {
        method: 'POST',
        path: '/operation',
        description: 'Crea una nueva operación',
      },
      {
        method: 'PATCH',
        path: '/operation/:id',
        description: 'Actualiza una operación existente',
      },
      {
        method: 'DELETE',
        path: '/operation/:id',
        description: 'Elimina una operación',
      },
    ],
  },
  client: {
    title: 'Gestión de Clientes',
    description:
      'Administración de la información de clientes y sus relaciones con la organización.',
    features: [
      'Registro y gestión de datos de clientes',
      'Historial de operaciones por cliente',
      'Gestión de contactos y comunicaciones',
    ],
    endpoints: [
      {
        method: 'GET',
        path: '/client',
        description: 'Obtiene todos los clientes',
      },
      {
        method: 'GET',
        path: '/client/:id',
        description: 'Obtiene un cliente por ID',
      },
      { method: 'POST', path: '/client', description: 'Crea un nuevo cliente' },
      {
        method: 'PATCH',
        path: '/client/:id',
        description: 'Actualiza un cliente existente',
      },
      {
        method: 'DELETE',
        path: '/client/:id',
        description: 'Elimina un cliente',
      },
    ],
  },
  task: {
    title: 'Gestión de Tareas',
    description:
      'Control de tareas específicas dentro de las operaciones. Permite el seguimiento detallado de actividades.',
    features: [
      'Creación y asignación de tareas',
      'Seguimiento de estado y progreso',
      'Notificaciones y recordatorios',
    ],
    endpoints: [
      { method: 'GET', path: '/task', description: 'Obtiene todas las tareas' },
      {
        method: 'GET',
        path: '/task/:id',
        description: 'Obtiene una tarea por ID',
      },
      { method: 'POST', path: '/task', description: 'Crea una nueva tarea' },
      {
        method: 'PATCH',
        path: '/task/:id',
        description: 'Actualiza una tarea existente',
      },
      { method: 'DELETE', path: '/task/:id', description: 'Elimina una tarea' },
    ],
  },
  auth: {
    title: 'Autenticación y Autorización',
    description:
      'Sistema de autenticación y control de acceso para proteger los recursos de la aplicación.',
    features: [
      'Autenticación por JWT',
      'Control de acceso basado en roles',
      'Protección de rutas y recursos',
    ],
    endpoints: [
      { method: 'POST', path: '/auth/login', description: 'Inicio de sesión' },
      { method: 'POST', path: '/auth/refresh', description: 'Refrescar token' },
      { method: 'POST', path: '/auth/logout', description: 'Cerrar sesión' },
    ],
  },
  common: {
    title: 'Componentes Comunes',
    description:
      'Módulos y utilidades compartidas que son utilizados por múltiples partes de la aplicación.',
    features: [
      'Validadores y pipes',
      'Interceptores y filtros',
      'Tipos y interfaces comunes',
    ],
    endpoints: [],
  },
  'cron-job': {
    title: 'Tareas Programadas',
    description:
      'Sistema de tareas automáticas programadas para ejecutarse en intervalos específicos.',
    features: [
      'Actualización automática de estados de operaciones',
      'Envío de notificaciones programadas',
      'Generación de reportes periódicos',
    ],
    endpoints: [],
  },
  prisma: {
    title: 'Capa de Acceso a Datos (Prisma)',
    description:
      'Servicios y configuraciones para interactuar con la base de datos mediante el ORM Prisma.',
    features: [
      'Conexión y configuración de la base de datos',
      'Migraciones y semillas de datos',
      'Servicios de acceso a datos',
    ],
    endpoints: [],
  },
};

// Crear directorio principal de documentación
const mainDocsDir = './docs';
if (!fs.existsSync(mainDocsDir)) {
  fs.mkdirSync(mainDocsDir);
} else {
  // Si existe, limpiarlo
  fs.rmSync(mainDocsDir, { recursive: true, force: true });
  fs.mkdirSync(mainDocsDir);
}

// Crear README personalizado para cada módulo
const createModuleReadme = (resource) => {
  const moduleInfo = moduleDescriptions[resource] || {
    title: `${resource.charAt(0).toUpperCase() + resource.slice(1)}`,
    description: `Módulo de ${resource}`,
    features: [],
    endpoints: [],
  };
  // Agregar botón de regreso al inicio
  let readmeContent = `[⬅️ Volver al inicio](../index.html)\n\n`;

  readmeContent += `# ${moduleInfo.title}\n\n`;
  readmeContent += `## Descripción\n\n${moduleInfo.description}\n\n`;

  if (moduleInfo.features && moduleInfo.features.length) {
    readmeContent += '## Funcionalidades\n\n';
    moduleInfo.features.forEach((feature) => {
      readmeContent += `- ${feature}\n`;
    });
    readmeContent += '\n';
  }

  if (moduleInfo.endpoints && moduleInfo.endpoints.length) {
    readmeContent += '## Endpoints\n\n';
    readmeContent += '| Método | Ruta | Descripción |\n';
    readmeContent += '|--------|------|-------------|\n';
    moduleInfo.endpoints.forEach((endpoint) => {
      readmeContent += `| ${endpoint.method} | ${endpoint.path} | ${endpoint.description} |\n`;
    });
    readmeContent += '\n';
  }

  readmeContent += '## Clases y Componentes\n\n';
 // Generar documentación de clases y componentes basado en los archivos del módulo
 const modulePath = path.join(process.cwd(), 'src', resource);
 if (fs.existsSync(modulePath)) {
   // Analizar los archivos en el directorio del módulo
   const files = getFilesRecursively(modulePath);
   
   // Agrupar por tipo (controllers, services, etc.)
   const typeGroups = {
     controllers: files.filter(file => file.includes('.controller.')),
     services: files.filter(file => file.includes('.service.')),
     modules: files.filter(file => file.includes('.module.')),
     dtos: files.filter(file => file.includes('.dto.')),
     entities: files.filter(file => file.includes('.entity.')),
     guards: files.filter(file => file.includes('.guard.')),
     pipes: files.filter(file => file.includes('.pipe.')),
     interfaces: files.filter(file => file.includes('.interface.')),
     others: files.filter(file => 
       !file.includes('.controller.') && 
       !file.includes('.service.') && 
       !file.includes('.module.') && 
       !file.includes('.dto.') && 
       !file.includes('.entity.') && 
       !file.includes('.guard.') && 
       !file.includes('.pipe.') && 
       !file.includes('.interface.') &&
       !file.includes('.spec.')
     )
   };
   
   // Generar documentación para cada tipo
   if (typeGroups.controllers.length) {
     readmeContent += '### Controladores\n\n';
     readmeContent += 'Los controladores son responsables de manejar las solicitudes HTTP entrantes y devolver respuestas al cliente.\n\n';
     typeGroups.controllers.forEach(file => {
       const fileName = path.basename(file);
       const className = getClassName(fileName);
       const shortName = fileName.replace('.controller.ts', '');
       readmeContent += `- **${className}**: Maneja las operaciones HTTP relacionadas con ${shortName}.\n`;
     });
     readmeContent += '\n';
   }
   
   if (typeGroups.services.length) {
     readmeContent += '### Servicios\n\n';
     readmeContent += 'Los servicios contienen la lógica de negocio y son utilizados por los controladores.\n\n';
     typeGroups.services.forEach(file => {
       const fileName = path.basename(file);
       const className = getClassName(fileName);
       const shortName = fileName.replace('.service.ts', '');
       readmeContent += `- **${className}**: Implementa la lógica para gestionar ${shortName}.\n`;
     });
     readmeContent += '\n';
   }
   
   if (typeGroups.modules.length) {
     readmeContent += '### Módulos\n\n';
     readmeContent += 'Los módulos agrupan componentes relacionados en un mismo contexto.\n\n';
     typeGroups.modules.forEach(file => {
       const fileName = path.basename(file);
       const className = getClassName(fileName);
       readmeContent += `- **${className}**: Organiza y configura los componentes relacionados con ${resource}.\n`;
     });
     readmeContent += '\n';
   }
   
   if (typeGroups.dtos.length) {
     readmeContent += '### DTOs (Data Transfer Objects)\n\n';
     readmeContent += 'Los DTOs definen la estructura de los datos que se transfieren entre cliente y servidor.\n\n';
     typeGroups.dtos.forEach(file => {
       const fileName = path.basename(file);
       const className = getClassName(fileName);
       readmeContent += `- **${className}**: Define la estructura de datos para operaciones de ${fileName.replace('.dto.ts', '')}.\n`;
     });
     readmeContent += '\n';
   }
   
   if (typeGroups.entities.length) {
     readmeContent += '### Entidades\n\n';
     readmeContent += 'Las entidades representan los modelos de datos en la base de datos.\n\n';
     typeGroups.entities.forEach(file => {
       const fileName = path.basename(file);
       const className = getClassName(fileName);
       readmeContent += `- **${className}**: Representa un modelo de datos para ${fileName.replace('.entity.ts', '')}.\n`;
     });
     readmeContent += '\n';
   }
   
   if (typeGroups.guards.length) {
     readmeContent += '### Guards\n\n';
     readmeContent += 'Los guards protegen las rutas y controlan el acceso a recursos específicos.\n\n';
     typeGroups.guards.forEach(file => {
       const fileName = path.basename(file);
       const className = getClassName(fileName);
       readmeContent += `- **${className}**: Controla el acceso a ${fileName.replace('.guard.ts', '')}.\n`;
     });
     readmeContent += '\n';
   }
   
   if (typeGroups.pipes.length) {
     readmeContent += '### Pipes\n\n';
     readmeContent += 'Los pipes transforman y validan los datos de entrada.\n\n';
     typeGroups.pipes.forEach(file => {
       const fileName = path.basename(file);
       const className = getClassName(fileName);
       readmeContent += `- **${className}**: Procesa los datos para ${fileName.replace('.pipe.ts', '')}.\n`;
     });
     readmeContent += '\n';
   }
   
   if (typeGroups.interfaces.length) {
     readmeContent += '### Interfaces\n\n';
     readmeContent += 'Las interfaces definen contratos para tipos de datos.\n\n';
     typeGroups.interfaces.forEach(file => {
       const fileName = path.basename(file);
       const interfaceName = getInterfaceName(fileName);
       readmeContent += `- **${interfaceName}**: Define la estructura para ${fileName.replace('.interface.ts', '')}.\n`;
     });
     readmeContent += '\n';
   }
   
   if (typeGroups.others.length) {
     readmeContent += '### Otros Componentes\n\n';
     readmeContent += 'Otros archivos y utilidades incluidos en este módulo.\n\n';
     typeGroups.others.forEach(file => {
       const fileName = path.basename(file);
       readmeContent += `- **${fileName}**: Archivo adicional relacionado con el módulo.\n`;
     });
     readmeContent += '\n';
   }
   
   readmeContent += '> Para ver detalles de implementación, revisar la documentación generada automáticamente a continuación.\n\n';
 } else {
   readmeContent += 'No se encontraron componentes en este módulo. Es posible que sea un módulo de configuración o utilidades.\n\n';
 }

 return readmeContent;
};

// Función auxiliar para obtener todos los archivos recursivamente
function getFilesRecursively(dir: string): string[] {
 let results: string[] = [];
 const items = fs.readdirSync(dir);
 
 for (const item of items) {
   const itemPath = path.join(dir, item);
   const stat = fs.statSync(itemPath);
   
   if (stat.isDirectory()) {
     results = results.concat(getFilesRecursively(itemPath));
   } else if (item.endsWith('.ts') && !item.endsWith('.spec.ts') && !item.endsWith('.test.ts')) {
     results.push(itemPath);
   }
 }
 
 return results;
}

// Función para convertir nombre de archivo a nombre de clase
function getClassName(fileName) {
 // Convertir kebab-case a CamelCase
 return fileName
   .split('-')
   .map(part => part.charAt(0).toUpperCase() + part.slice(1))
   .join('')
   .replace(/\.(controller|service|module|dto|entity|guard|pipe)\.ts$/, '$1');
}

// Función para convertir nombre de archivo a nombre de interfaz
function getInterfaceName(fileName) {
 // Convertir kebab-case a CamelCase pero mantener la "I" al inicio
 return 'I' + fileName
   .split('-')
   .map(part => part.charAt(0).toUpperCase() + part.slice(1))
   .join('')
   .replace(/\.interface\.ts$/, '');
}

// Generar documentación para cada recurso
console.log('Generando documentación por recursos...');
resources.forEach((resource) => {
  console.log(`Generando documentación para: ${resource}`);

  // Crear README para el módulo
  const moduleReadme = createModuleReadme(resource);
  const moduleDirPath = path.join(mainDocsDir, resource);

  // Asegurarse de que el directorio del módulo existe
  if (!fs.existsSync(moduleDirPath)) {
    fs.mkdirSync(moduleDirPath, { recursive: true });
  }

  // Guardar README temporal
  const moduleReadmePath = path.join(
    process.cwd(),
    `temp-${resource}-readme.md`,
  );
  fs.writeFileSync(moduleReadmePath, moduleReadme);

  // Crear configuración temporal para este recurso
  const configPath = `./typedoc-${resource}.json`;
  const config = {
    entryPoints: [`./src/${resource}/**/*.ts`],
    exclude: [
      '**/node_modules/**',
      '**/*.spec.ts',
      '**/*.test.ts',
      '**/dist/**',
    ],
    out: `./docs/${resource}`,
    name: `Documentación ${resource.charAt(0).toUpperCase() + resource.slice(1)}`,
    excludePrivate: true,
    entryPointStrategy: 'expand',
    readme: `./temp-${resource}-readme.md`, // Usar el README específico para este módulo
  };

  // Escribir el archivo de configuración
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  try {
    // Ejecutar TypeDoc con esta configuración
    execSync(`npx typedoc --options ${configPath}`, { stdio: 'inherit' });
    console.log(`✓ Documentación generada para ${resource}`);
  } catch (error) {
    console.error(
      `Error generando documentación para ${resource}:`,
      error.message,
    );
  } finally {
    // Eliminar los archivos temporales
    fs.unlinkSync(configPath);
    fs.unlinkSync(moduleReadmePath);
  }
});

// Convertir README.md a HTML
// console.log('Procesando README.md...');
let readmeHtml = '';
try {
  const readmePath = './README.md';
  if (fs.existsSync(readmePath)) {
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    readmeHtml = marked.parse(readmeContent);
  } else {
    readmeHtml = '<p>No se encontró README.md</p>';
    console.warn('Advertencia: No se encontró el archivo README.md');
  }
} catch (error) {
  console.error('Error procesando README.md:', error);
  readmeHtml = '<p>Error al procesar README.md</p>';
}

// Obtener información del package.json para la documentación
let packageInfo = {
  name: 'ServidorCargoPlanner API',
  version: '1.0.0',
  description: 'API Documentation',
};
try {
  const packageJsonPath = './package.json';
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    packageInfo = {
      name: packageJson.name || packageInfo.name,
      version: packageJson.version || packageInfo.version,
      description: packageJson.description || packageInfo.description,
    };
  }
} catch (error) {
  console.error('Error leyendo package.json:', error);
}

// Crear índice principal con estilos neumórficos
console.log('Creando índice principal con estilos neumórficos...');
let indexHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <title>${packageInfo.name} - Documentación</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="./assets/nest.ico" type="image/x-icon">
  
  <style>
    :root {
      --background: #f8f9fa;
      --text-color: #212529;
      --primary: #4361ee;
      --shadow-light: #ffffff;
      --shadow-dark: #d1d9e6;
      --radius: 15px;
    }

    body.dark-theme {
      --background: #1e293b;
      --text-color: #f1f5f9;
      --primary: #60a5fa;
      --shadow-light: #2c3e50;
      --shadow-dark: #0f172a;
    }

    * {
      box-sizing: border-box;
      transition: all 0.3s ease;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0;
      padding: 0;
      background-color: var(--background);
      color: var(--text-color);
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    header {
      text-align: center;
      margin-bottom: 3rem;
      padding: 1rem;
      border-radius: var(--radius);
      box-shadow: 8px 8px 15px var(--shadow-dark), -8px -8px 15px var(--shadow-light);
      background: var(--background);
    }

    h1 {
      font-size: 2.5rem;
      margin: 0.5rem 0;
      color: var(--primary);
    }

    .version {
      display: inline-block;
      padding: 0.3rem 0.8rem;
      border-radius: 50px;
      background: var(--primary);
      color: white;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }

    .description {
      font-size: 1.2rem;
      opacity: 0.8;
      max-width: 800px;
      margin: 0 auto;
    }

    .tabs {
      display: flex;
      justify-content: center;
      margin: 2rem 0;
      gap: 1rem;
    }

    .tab {
      padding: 0.8rem 1.5rem;
      cursor: pointer;
      border-radius: var(--radius);
      box-shadow: 4px 4px 8px var(--shadow-dark), -4px -4px 8px var(--shadow-light);
      background: var(--background);
      color: var(--text-color);
      font-weight: 500;
      opacity: 0.7;
    }

    .tab:hover {
      opacity: 1;
    }

    .tab.active {
      opacity: 1;
      box-shadow: inset 4px 4px 8px var(--shadow-dark), inset -4px -4px 8px var(--shadow-light);
      color: var(--primary);
    }

    .content-section {
      display: none;
    }

    .content-section.active {
      display: block;
    }

    .readme {
      background: var(--background);
      border-radius: var(--radius);
      padding: 2rem;
      box-shadow: 8px 8px 15px var(--shadow-dark), -8px -8px 15px var(--shadow-light);
      margin-bottom: 2rem;
    }

    .readme img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
    }

    .readme h1, .readme h2, .readme h3 {
      color: var(--primary);
    }

    .readme code {
      background: rgba(0,0,0,0.1);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
    }

    .readme pre {
      background: rgba(0,0,0,0.1);
      padding: 1rem;
      border-radius: var(--radius);
      overflow-x: auto;
    }

    .resources {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 2rem;
    }

    .resource {
      background: var(--background);
      border-radius: var(--radius);
      padding: 2rem;
      box-shadow: 8px 8px 15px var(--shadow-dark), -8px -8px 15px var(--shadow-light);
      text-align: center;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .resource:hover {
      transform: translateY(-5px);
      box-shadow: 10px 10px 20px var(--shadow-dark), -10px -10px 20px var(--shadow-light);
    }

    .resource h2 {
      color: var(--primary);
      margin-top: 0;
      font-size: 1.5rem;
    }

    .resource-icon {
      font-size: 2.5rem;
      margin-bottom: 1rem;
      color: var(--primary);
    }

    .btn {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.8rem 1.5rem;
      border-radius: var(--radius);
      background: var(--background);
      color: var(--primary);
      text-decoration: none;
      font-weight: 500;
      box-shadow: 4px 4px 8px var(--shadow-dark), -4px -4px 8px var(--shadow-light);
    }

    .btn:hover {
      box-shadow: 6px 6px 10px var(--shadow-dark), -6px -6px 10px var(--shadow-light);
      color: var(--primary);
    }

    footer {
      text-align: center;
      margin-top: 3rem;
      padding: 1rem;
      opacity: 0.7;
    }

    @media (max-width: 768px) {
      .tabs {
        flex-direction: column;
        align-items: center;
      }
      
      .container {
        padding: 1rem;
      }
      
      header {
        padding: 1rem 0.5rem;
      }
      
      h1 {
        font-size: 2rem;
      }
    }
    
    .theme-toggle {
      position: fixed;
      top: 1rem;
      right: 1rem;
      padding: 0.5rem;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 4px 4px 8px var(--shadow-dark), -4px -4px 8px var(--shadow-light);
      background: var(--background);
      border: none;
      color: var(--text-color);
      cursor: pointer;
    }
  </style>
</head>
<body>
  <button class="theme-toggle" id="themeToggle">🌓</button>
  
  <div class="container">
    <header>
      <h1>${packageInfo.name}</h1>
      <span class="version">v${packageInfo.version}</span>
      <p class="description">${packageInfo.description}</p>
    </header>
    
    <div class="tabs">
      <div class="tab active" data-target="overview">Descripción</div>
      <div class="tab" data-target="modules">Módulos</div>
    </div>
    
    <div class="content-section active" id="overview">
      <div class="readme">
        ${readmeHtml}
      </div>
    </div>
    
    <div class="content-section" id="modules">
      <div class="resources">`;

// Iconos para cada recurso (emojis como fallback)
const resourceIcons = {
  area: '🏢',
  user: '🧑‍💻',
  worker: '👷',
  operation: '⚙️',
  client: '🧑‍💼',
  task: '📋',
  auth: '🔒',
  common: '🧰',
  'cron-job': '⏱️',
  prisma: '⚡',
};

// Añadir enlaces a cada recurso
resources.forEach((resource) => {
  const moduleInfo = moduleDescriptions[resource] || {
    title: resource.charAt(0).toUpperCase() + resource.slice(1),
  };
  const icon = resourceIcons[resource] || '📄';

  indexHtml += `
        <div class="resource">
          <div class="resource-icon">${icon}</div>
          <h2>${moduleInfo.title}</h2>
          <a href="./${resource}/index.html" class="btn">Ver documentación</a>
        </div>`;
});

indexHtml += `
      </div>
    </div>
    
    <footer>
      <p>${new Date().toLocaleDateString()}</p>
    </footer>
  </div>

    <script>
    // Inicialización inmediata para el tema
    (function() {
      const themeToggle = document.getElementById('themeToggle');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const storedTheme = localStorage.getItem('darkTheme');
      
      // Función para alternar el tema
      function toggleTheme() {
        document.body.classList.toggle('dark-theme');
        
        // Almacenar preferencia de tema
        const isDarkTheme = document.body.classList.contains('dark-theme');
        localStorage.setItem('darkTheme', isDarkTheme.toString());
        
        // Cambiar el ícono según el tema
        themeToggle.textContent = isDarkTheme ? '☀️' : '🌓';
      }
      
      // Aplicar tema guardado o preferencia del sistema al cargar
      if (storedTheme === 'true' || (storedTheme === null && prefersDark)) {
        document.body.classList.add('dark-theme');
        themeToggle.textContent = '☀️';
      }
      
      // Agregar el evento de clic
      themeToggle.addEventListener('click', toggleTheme);
    })();

    // Funcionalidad de pestañas
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        // Quitar clase activa de todas las pestañas
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.content-section').forEach(c => c.classList.remove('active'));
        
        // Añadir clase activa a la pestaña seleccionada
        tab.classList.add('active');
        
        // Mostrar el contenido correspondiente
        const target = tab.getAttribute('data-target');
        document.getElementById(target).classList.add('active');
      });
    });
  </script>
</body>
</html>`;

// Escribir el archivo index.html
fs.writeFileSync(path.join(mainDocsDir, 'index.html'), indexHtml);

// Copiar recursos estáticos si existen
const assetsDir = './docs-assets';
if (fs.existsSync(assetsDir)) {
  const destAssetsDir = path.join(mainDocsDir, 'assets');
  if (!fs.existsSync(destAssetsDir)) {
    fs.mkdirSync(destAssetsDir, { recursive: true });
  }

  // Función para copiar un directorio recursivamente
  function copyDir(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (let entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDir(assetsDir, destAssetsDir);
  console.log('✓ Recursos estáticos copiados');
}

console.log(
  '✨ Documentación completada. Abre ./docs/index.html para ver el resultado.',
);
