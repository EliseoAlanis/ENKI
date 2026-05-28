# Kahoot Web3 Descentralizado con Prize Pool

Bienvenido al repositorio de **ENKI**, un sistema descentralizado de Trivia construido sobre Ethereum, que incorpora un Prize Pool y la entrega de Diplomas en formato NFT.

## Características Principales

- **Patrón Commit-Reveal Seguro:** Evita que los alumnos copien las respuestas de otros mirando las transacciones pendientes en la mempool. Los estudiantes envían un hash de su respuesta (Commit) y luego revelan la opción elegida (Reveal).
- **Prize Pool (Pozo de Premios):** Cada estudiante paga un *entry fee* (cuota de entrada) en ETH para participar. Todo lo recaudado forma un pozo de premios que se distribuye automáticamente de la siguiente manera al finalizar el juego:
  - 🥇 **1er Puesto (Puntaje más alto):** 60% del pozo.
  - 🥈 **2do Puesto:** 20% del pozo.
  - 🥉 **3er Puesto:** 10% del pozo.
  - 👨‍🏫 **Profesor:** 10% del pozo (más premios vacantes o sobrantes por redondeo).
- **Diploma NFT:** Los alumnos que superan el puntaje mínimo de aprobación (Passing Score) tienen derecho a mintear un NFT intransferible que acredita su conocimiento en la blockchain.
- **Factory Pattern:** El sistema permite a cualquier profesor crear su propia partida (instancia de KahootGame) estableciendo la cantidad de preguntas, el puntaje mínimo y el costo de entrada a través de `KahootFactory`.
- **Mitigación de Race Conditions:** Protecciones robustas que evitan que los alumnos se unan a un juego en progreso una vez que ya se abrió la primera pregunta.

## Requisitos Previos

- [Node.js](https://nodejs.org/es/) v18+ 
- Un gestor de paquetes como `npm` o `yarn`

## Instalación

1. Clona este repositorio y navega hasta el directorio del proyecto.
2. Instala las dependencias del proyecto ejecutando:

```bash
npm install
```

## Compilación

Para compilar los contratos inteligentes (escritos en Solidity ^0.8.20), ejecuta:

```bash
npx hardhat compile
```

Esto generará los artifacts necesarios dentro de la carpeta `artifacts/`.

## Tests

El proyecto cuenta con una cobertura absoluta (100%) a través de una rigurosa suite de pruebas unitarias y de integración que verifica tanto el *happy path* como todos los posibles *edge cases* (ataques de replay, colisión de fases, commits nulos y condiciones de carrera).

Para correr los tests utilizando **Node:Test** y **Viem**, ejecuta:

```bash
npx hardhat test
```

Verás en consola el reporte detallado con todos los tests pasando exitosamente.

## Arquitectura de Contratos

- `KahootFactory.sol`: Contrato principal para crear nuevas instancias de partidas.
- `KahootGame.sol`: Maneja la lógica de la trivia, el registro (joinGame), las fases (commit y reveal) y el cálculo matemático del Prize Pool con un histograma dinámico eficiente en gas.
- `DiplomaNFT.sol`: Extensión de ERC721 que emite el certificado para los alumnos aprobados.
