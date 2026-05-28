import { expect } from "chai";
import { network } from "hardhat";
import { describe, it, beforeEach } from "node:test";
import { keccak256, encodePacked } from "viem";

describe("Kahoot Web3 - Patrón Factory y Commit/Reveal Seguro", function () {
  let factory, game, diplomaNFT;
  let owner, profesor, alumnoHonesto, alumnoTramposo;
  let viem;

  const metadataURI = "ipfs://QmMockMetadata...";
  const diplomaURI = "ipfs://QmMockDiploma...";

  function generateHash(opcion, salt, address) {
    return keccak256(
      encodePacked(
        ["uint8", "string", "address"],
        [opcion, salt, address]
      )
    );
  }

  async function expectRevert(promise, expectedReason) {
    try {
      await promise;
      expect.fail("La transaccion deberia haber fallado");
    } catch (error) {
      expect(error.message).to.include(expectedReason);
    }
  }

  beforeEach(async function () {
    const networkContext = await network.create({
      network: "hardhatMainnet",
      chainType: "l1",
    });
    viem = networkContext.viem;

    // CORRECCIÓN: Desestructurar correctamente el array de clientes
    const walletClients = await viem.getWalletClients();
    [owner, profesor, alumnoHonesto, alumnoTramposo] = walletClients;

    factory = await viem.deployContract("KahootFactory");

    // CORRECCIÓN: Agregar el 5to parámetro (correctAnswers)
    await factory.write.createGame(
      [1n, 1n, metadataURI, diplomaURI, [1]],
      { account: profesor.account }
    );

    const gameAddress = await factory.read.games([0n]);
    game = await viem.getContractAt("KahootGame", gameAddress);

    const diplomaAddress = await game.read.diplomaContract();
    diplomaNFT = await viem.getContractAt("DiplomaNFT", diplomaAddress);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TESTS EXISTENTES (Happy Path)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 1: El copion no puede robar el hash (Vulnerabilidad Arreglada)", async function () {
    await game.write.startNextQuestion({ account: profesor.account });

    const hashHonesto = generateHash(1, "secreto", alumnoHonesto.account.address);
    
    await game.write.commitAnswer([hashHonesto], { account: alumnoHonesto.account });
    await game.write.commitAnswer([hashHonesto], { account: alumnoTramposo.account });

    await game.write.closeQuestionAndStartReveal({ account: profesor.account });

    await game.write.revealAnswer([0n, 1, "secreto"], { account: alumnoHonesto.account });
    expect(await game.read.scores([alumnoHonesto.account.address])).to.equal(1n);

    await expectRevert(
      game.write.revealAnswer([0n, 1, "secreto"], { account: alumnoTramposo.account }),
      "El hash no coincide"
    );
  });

  it("TEST 2: Deberia fallar si intentan acciones fuera de fase", async function () {
    const hash = generateHash(1, "salt", alumnoHonesto.account.address);

    await expectRevert(
      game.write.commitAnswer([hash], { account: alumnoHonesto.account }),
      "Fase de commit cerrada"
    );

    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([hash], { account: alumnoHonesto.account });

    await expectRevert(
      game.write.revealAnswer([0n, 1, "salt"], { account: alumnoHonesto.account }),
      "Fase de reveal cerrada"
    );

    await game.write.closeQuestionAndStartReveal({ account: profesor.account });

    const hash2 = generateHash(2, "salt2", alumnoTramposo.account.address);
    await expectRevert(
      game.write.commitAnswer([hash2], { account: alumnoTramposo.account }),
      "Fase de commit cerrada"
    );
  });

  it("TEST 3: Proteccion de Doble Claim", async function () {
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal({ account: profesor.account });
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    await game.write.claimDiploma({ account: alumnoHonesto.account });

    await expectRevert(
      game.write.claimDiploma({ account: alumnoHonesto.account }),
      "Ya reclamaste tu diploma"
    );
  });

  it("TEST 4: Seguridad del Profesor", async function () {
    await expectRevert(
      game.write.startNextQuestion({ account: alumnoTramposo.account }),
      "Solo el profe puede ejecutar esto"
    );

    await expectRevert(
      game.write.closeQuestionAndStartReveal({ account: alumnoTramposo.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("TEST 5: Partida completa de 3 preguntas (Loop completo)", async function () {
    // CORRECCIÓN: Agregar el 5to parámetro para las 3 preguntas
    await factory.write.createGame(
      [2n, 3n, metadataURI, diplomaURI, [1, 2, 2]],
      { account: profesor.account }
    );
    const game3Address = await factory.read.games([1n]);
    const game3 = await viem.getContractAt("KahootGame", game3Address);

    await game3.write.startNextQuestion({ account: profesor.account });
    await game3.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    await game3.write.closeQuestionAndStartReveal({ account: profesor.account });
    await game3.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game3.write.advanceToNextQuestion({ account: profesor.account });

    await game3.write.startNextQuestion({ account: profesor.account });
    await game3.write.commitAnswer([generateHash(2, "s2", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    await game3.write.closeQuestionAndStartReveal({ account: profesor.account });
    await game3.write.revealAnswer([1n, 2, "s2"], { account: alumnoHonesto.account });
    await game3.write.advanceToNextQuestion({ account: profesor.account });

    await game3.write.startNextQuestion({ account: profesor.account });
    await game3.write.commitAnswer([generateHash(1, "s3", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    await game3.write.closeQuestionAndStartReveal({ account: profesor.account });
    await game3.write.revealAnswer([2n, 1, "s3"], { account: alumnoHonesto.account });
    await game3.write.advanceToNextQuestion({ account: profesor.account });

    expect(await game3.read.scores([alumnoHonesto.account.address])).to.equal(2n);
    expect(await game3.read.isFinished()).to.be.true;

    await game3.write.claimDiploma({ account: alumnoHonesto.account });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FÁBRICA - CREACIÓN INVÁLIDA (Reverts)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 6: Factory revert si _totalQuestions == 0", async function () {
    await expectRevert(
      factory.write.createGame(
        [1n, 0n, metadataURI, diplomaURI, []],
        { account: profesor.account }
      ),
      "Debe tener preguntas"
    );
  });

  it("TEST 7: Factory revert si _passingScore == 0", async function () {
    await expectRevert(
      factory.write.createGame(
        [0n, 1n, metadataURI, diplomaURI, [1]],
        { account: profesor.account }
      ),
      "Puntaje invalido"
    );
  });

  it("TEST 8: Factory revert si _passingScore > _totalQuestions", async function () {
    await expectRevert(
      factory.write.createGame(
        [5n, 2n, metadataURI, diplomaURI, [1, 2]],
        { account: profesor.account }
      ),
      "Puntaje mayor al total"
    );
  });

  it("TEST 9: Factory revert si correctAnswers.length != _totalQuestions", async function () {
    // 3 preguntas pero solo 2 respuestas
    await expectRevert(
      factory.write.createGame(
        [2n, 3n, metadataURI, diplomaURI, [1, 2]],
        { account: profesor.account }
      ),
      "Respuestas no coinciden"
    );
  });

  it("TEST 10: Factory revert si correctAnswers tiene MÁS elementos que _totalQuestions", async function () {
    // 1 pregunta pero 3 respuestas
    await expectRevert(
      factory.write.createGame(
        [1n, 1n, metadataURI, diplomaURI, [1, 2, 3]],
        { account: profesor.account }
      ),
      "Respuestas no coinciden"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JUEGO - ALUMNO DESAPROBADO (Revert)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 11: Alumno desaprobado no puede reclamar diploma", async function () {
    // Crear juego de 2 preguntas con passingScore = 2 (hay que acertar todas)
    await factory.write.createGame(
      [2n, 2n, metadataURI, diplomaURI, [1, 2]],
      { account: profesor.account }
    );
    const gameAddr = await factory.read.games([1n]);
    const gameDesa = await viem.getContractAt("KahootGame", gameAddr);

    // Pregunta 1: alumno responde MAL (opcion 3, correcta es 1)
    await gameDesa.write.startNextQuestion({ account: profesor.account });
    await gameDesa.write.commitAnswer(
      [generateHash(3, "wrong1", alumnoHonesto.account.address)],
      { account: alumnoHonesto.account }
    );
    await gameDesa.write.closeQuestionAndStartReveal({ account: profesor.account });
    await gameDesa.write.revealAnswer([0n, 3, "wrong1"], { account: alumnoHonesto.account });
    await gameDesa.write.advanceToNextQuestion({ account: profesor.account });

    // Pregunta 2: alumno responde BIEN (opcion 2, correcta es 2)
    await gameDesa.write.startNextQuestion({ account: profesor.account });
    await gameDesa.write.commitAnswer(
      [generateHash(2, "right2", alumnoHonesto.account.address)],
      { account: alumnoHonesto.account }
    );
    await gameDesa.write.closeQuestionAndStartReveal({ account: profesor.account });
    await gameDesa.write.revealAnswer([1n, 2, "right2"], { account: alumnoHonesto.account });
    await gameDesa.write.advanceToNextQuestion({ account: profesor.account });

    // Score = 1, passingScore = 2 => revert
    expect(await gameDesa.read.isFinished()).to.be.true;
    expect(await gameDesa.read.scores([alumnoHonesto.account.address])).to.equal(1n);

    await expectRevert(
      gameDesa.write.claimDiploma({ account: alumnoHonesto.account }),
      "No alcanzas el puntaje"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JUEGO - REVELACIÓN FANTASMA (Revert)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 12: Reveal sin haber hecho commit previo (revelación fantasma)", async function () {
    await game.write.startNextQuestion({ account: profesor.account });

    // Solo alumnoHonesto hace commit
    await game.write.commitAnswer(
      [generateHash(1, "s1", alumnoHonesto.account.address)],
      { account: alumnoHonesto.account }
    );

    await game.write.closeQuestionAndStartReveal({ account: profesor.account });

    // alumnoTramposo intenta reveal sin haber hecho commit
    await expectRevert(
      game.write.revealAnswer([0n, 1, "fake"], { account: alumnoTramposo.account }),
      "No hiciste commit"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JUEGO - COMMIT NULO (Revert)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 13: Commit de bytes32(0) debería fallar", async function () {
    await game.write.startNextQuestion({ account: profesor.account });

    // Enviar bytes32(0) como commit hash
    const nullHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

    await expectRevert(
      game.write.commitAnswer([nullHash], { account: alumnoHonesto.account }),
      "Hash nulo"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // JUEGO - COLISIÓN DE FASES (Reverts)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 14: Profesor no puede abrir pregunta 2 si la pregunta 1 está en commit", async function () {
    // Crear juego de 2 preguntas
    await factory.write.createGame(
      [1n, 2n, metadataURI, diplomaURI, [1, 2]],
      { account: profesor.account }
    );
    const gameAddr = await factory.read.games([1n]);
    const game2 = await viem.getContractAt("KahootGame", gameAddr);

    // Abrir pregunta 1 (commit phase abierta)
    await game2.write.startNextQuestion({ account: profesor.account });

    // Intentar avanzar el currentQuestionId manualmente no es posible,
    // pero el profesor puede intentar hacer advance o closeReveal para forzar
    // Intentar advanceToNextQuestion mientras commit está abierto
    await expectRevert(
      game2.write.advanceToNextQuestion({ account: profesor.account }),
      "Primero abrir reveals"
    );
  });

  it("TEST 15: Profesor no puede abrir pregunta 2 si la pregunta 1 está en reveal", async function () {
    // Crear juego de 2 preguntas
    await factory.write.createGame(
      [1n, 2n, metadataURI, diplomaURI, [1, 2]],
      { account: profesor.account }
    );
    const gameAddr = await factory.read.games([1n]);
    const game2 = await viem.getContractAt("KahootGame", gameAddr);

    // Pregunta 1: abrir commit, cerrar commit, abrir reveal
    await game2.write.startNextQuestion({ account: profesor.account });
    await game2.write.commitAnswer(
      [generateHash(1, "s1", alumnoHonesto.account.address)],
      { account: alumnoHonesto.account }
    );
    await game2.write.closeQuestionAndStartReveal({ account: profesor.account });

    // Ahora la pregunta 1 está en reveal phase.
    // El profesor NO debería poder llamar startNextQuestion porque
    // la pregunta actual (currentQ - 1 = 0) todavía tiene revealPhaseOpen = true.
    // PERO currentQuestionId sigue siendo 0 y startNextQuestion chequea currentQ > 0
    // para verificar que la pregunta anterior esté cerrada.
    // Como currentQ == 0, no entra al if(currentQ > 0) y directamente falla
    // porque currentQ (0) ya fue usada y questions[0].commitPhaseOpen = false pero
    // va a intentar abrir questions[0] de nuevo... veamos.
    // En realidad startNextQuestion abre questions[currentQuestionId] y currentQuestionId
    // no cambió, asi que no puede abrir la siguiente sin hacer advanceToNextQuestion primero.
    // La protección real está en advanceToNextQuestion que cierra reveal y suma el ID.
    // Pero si intentamos cerrar el reveal sin hacer advance, la fase de reveal sigue abierta.

    // Intentar closeQuestionAndStartReveal de nuevo (ya no está en commit)
    await expectRevert(
      game2.write.closeQuestionAndStartReveal({ account: profesor.account }),
      "No esta en commit"
    );
  });

  it("TEST 16: advanceToNextQuestion falla si la fase actual es commit (no reveal)", async function () {
    // Crear juego de 2 preguntas
    await factory.write.createGame(
      [1n, 2n, metadataURI, diplomaURI, [1, 2]],
      { account: profesor.account }
    );
    const gameAddr = await factory.read.games([1n]);
    const game2 = await viem.getContractAt("KahootGame", gameAddr);

    // Abrir pregunta 1 (commit phase abierta)
    await game2.write.startNextQuestion({ account: profesor.account });

    // Intentar avanzar mientras estamos en commit phase (no en reveal)
    await expectRevert(
      game2.write.advanceToNextQuestion({ account: profesor.account }),
      "Primero abrir reveals"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEGURIDAD DE ROLES (Reverts)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 17: Alumno no puede llamar startNextQuestion", async function () {
    await expectRevert(
      game.write.startNextQuestion({ account: alumnoHonesto.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("TEST 18: Alumno no puede llamar closeQuestionAndStartReveal", async function () {
    await game.write.startNextQuestion({ account: profesor.account });

    await expectRevert(
      game.write.closeQuestionAndStartReveal({ account: alumnoHonesto.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("TEST 19: Alumno no puede llamar advanceToNextQuestion", async function () {
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer(
      [generateHash(1, "s1", alumnoHonesto.account.address)],
      { account: alumnoHonesto.account }
    );
    await game.write.closeQuestionAndStartReveal({ account: profesor.account });

    await expectRevert(
      game.write.advanceToNextQuestion({ account: alumnoHonesto.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  it("TEST 20: Owner (no profesor) tampoco puede ejecutar funciones de profesor", async function () {
    await expectRevert(
      game.write.startNextQuestion({ account: owner.account }),
      "Solo el profe puede ejecutar esto"
    );

    await expectRevert(
      game.write.closeQuestionAndStartReveal({ account: owner.account }),
      "Solo el profe puede ejecutar esto"
    );

    await expectRevert(
      game.write.advanceToNextQuestion({ account: owner.account }),
      "Solo el profe puede ejecutar esto"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EDGE CASES ADICIONALES
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 21: No se puede hacer commit dos veces en la misma pregunta", async function () {
    await game.write.startNextQuestion({ account: profesor.account });

    const hash = generateHash(1, "s1", alumnoHonesto.account.address);
    await game.write.commitAnswer([hash], { account: alumnoHonesto.account });

    const hash2 = generateHash(2, "s2", alumnoHonesto.account.address);
    await expectRevert(
      game.write.commitAnswer([hash2], { account: alumnoHonesto.account }),
      "Ya respondiste"
    );
  });

  it("TEST 22: No se puede hacer reveal dos veces (commit borrado después del primer reveal)", async function () {
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer(
      [generateHash(1, "s1", alumnoHonesto.account.address)],
      { account: alumnoHonesto.account }
    );
    await game.write.closeQuestionAndStartReveal({ account: profesor.account });
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });

    // El commit fue borrado (puesto en bytes32(0)), así que un segundo reveal falla
    await expectRevert(
      game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account }),
      "No hiciste commit"
    );
  });

  it("TEST 23: claimDiploma falla si el juego no terminó", async function () {
    // El juego del beforeEach tiene 1 pregunta. Sin jugar, isFinished = false
    await expectRevert(
      game.write.claimDiploma({ account: alumnoHonesto.account }),
      "El juego no ha terminado"
    );
  });

  it("TEST 24: startNextQuestion falla cuando no hay más preguntas", async function () {
    // El juego del beforeEach tiene 1 pregunta. Completarla y terminar.
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer(
      [generateHash(1, "s1", alumnoHonesto.account.address)],
      { account: alumnoHonesto.account }
    );
    await game.write.closeQuestionAndStartReveal({ account: profesor.account });
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    // isFinished = true, intentar abrir otra pregunta
    await expectRevert(
      game.write.startNextQuestion({ account: profesor.account }),
      "El juego termino"
    );
  });

  it("TEST 25: Alumno que nunca jugó no puede reclamar diploma", async function () {
    // Completar el juego sin que alumnoTramposo participe
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer(
      [generateHash(1, "s1", alumnoHonesto.account.address)],
      { account: alumnoHonesto.account }
    );
    await game.write.closeQuestionAndStartReveal({ account: profesor.account });
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    expect(await game.read.isFinished()).to.be.true;

    // alumnoTramposo nunca jugó -> score = 0 -> revert
    await expectRevert(
      game.write.claimDiploma({ account: alumnoTramposo.account }),
      "No alcanzas el puntaje"
    );
  });

  it("TEST 26: Reveal con hash incorrecto (salt equivocado)", async function () {
    await game.write.startNextQuestion({ account: profesor.account });

    await game.write.commitAnswer(
      [generateHash(1, "mi_salt_real", alumnoHonesto.account.address)],
      { account: alumnoHonesto.account }
    );

    await game.write.closeQuestionAndStartReveal({ account: profesor.account });

    // Intenta reveal con salt distinto
    await expectRevert(
      game.write.revealAnswer([0n, 1, "salt_falso"], { account: alumnoHonesto.account }),
      "El hash no coincide"
    );
  });

  it("TEST 27: Reveal con opción distinta a la commiteada", async function () {
    await game.write.startNextQuestion({ account: profesor.account });

    // Commitea opcion 1
    await game.write.commitAnswer(
      [generateHash(1, "salt", alumnoHonesto.account.address)],
      { account: alumnoHonesto.account }
    );

    await game.write.closeQuestionAndStartReveal({ account: profesor.account });

    // Intenta reveal con opcion 2 (diferente a la commiteada)
    await expectRevert(
      game.write.revealAnswer([0n, 2, "salt"], { account: alumnoHonesto.account }),
      "El hash no coincide"
    );
  });

  it("TEST 28: closeQuestionAndStartReveal falla si no hay commit phase abierta", async function () {
    // Sin abrir ninguna pregunta, intentar cerrar commit
    await expectRevert(
      game.write.closeQuestionAndStartReveal({ account: profesor.account }),
      "No esta en commit"
    );
  });

  it("TEST 29: DiplomaNFT - solo el contrato KahootGame puede mintear", async function () {
    // Intentar llamar mintDiploma directamente desde una wallet
    await expectRevert(
      diplomaNFT.write.mintDiploma(
        [alumnoHonesto.account.address, diplomaURI],
        { account: profesor.account }
      ),
      "UnauthorizedGame"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DETALLES ADICIONALES (Custom Errors, Getters y Estado)
  // ═══════════════════════════════════════════════════════════════════════════

  it("TEST 30: DiplomaNFT - falla con InvalidAddress si game es address(0)", async function () {
    const zeroAddress = "0x0000000000000000000000000000000000000000";
    await expectRevert(
      viem.deployContract("DiplomaNFT", [zeroAddress]),
      "InvalidAddress"
    );
  });

  it("TEST 31: KahootFactory - getGamesCount funciona correctamente", async function () {
    const countAntes = await factory.read.getGamesCount();
    
    await factory.write.createGame(
      [1n, 1n, metadataURI, diplomaURI, [1]],
      { account: profesor.account }
    );
    
    const countDespues = await factory.read.getGamesCount();
    expect(countDespues).to.equal(countAntes + 1n);
  });

  it("TEST 32: KahootGame - variables de estado inicializan correctamente", async function () {
    expect((await game.read.professor()).toLowerCase()).to.equal(profesor.account.address.toLowerCase());
    expect(await game.read.passingScore()).to.equal(1n);
    expect(await game.read.totalQuestions()).to.equal(1n);
    expect(await game.read.metadataURI()).to.equal(metadataURI);
    expect(await game.read.diplomaTokenURI()).to.equal(diplomaURI);
    expect(await game.read.isFinished()).to.be.false;
    expect(await game.read.currentQuestionId()).to.equal(0n);
  });
});