import { expect } from "chai";
import { network } from "hardhat";
import { describe, it, beforeEach } from "node:test";
import { keccak256, encodePacked, parseEther } from "viem";

describe("KahootGame - Economía y Prize Pool", function () {
  let factory, game;
  let owner, profesor;
  let a1, a2, a3, a4, a5;
  let viem;

  const diplomaURI = "ipfs://QmMockDiploma...";
  const profeSalt = "secretoProfe";
  const enunciado = "¿Cuánto es 2+2?";
  const opciones = ["A", "B", "C", "D"];
  const entryFee = parseEther("0.01");
  const creationFee = parseEther("0.001");

  function generateHash(opcion, salt, address) {
    return keccak256(
      encodePacked(
        ["uint8", "string", "address"],
        [opcion, salt, address]
      )
    );
  }

  function buildRonda(opcionCorrecta, profesorAddr) {
    return {
      hashVerificacionPregunta: keccak256(encodePacked(
        ["string", "string", "string", "string", "string", "string"],
        [enunciado, opciones[0], opciones[1], opciones[2], opciones[3], profeSalt]
      )),
      hashRespuestaCorrecta: generateHash(opcionCorrecta, profeSalt, profesorAddr),
      commitPhaseOpen: false,
      revealPhaseOpen: false,
    };
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

    const clients = await viem.getWalletClients();
    owner = clients[0];
    profesor = clients[1];
    a1 = clients[2];
    a2 = clients[3];
    a3 = clients[4];
    a4 = clients[5];
    a5 = clients[6];

    factory = await viem.deployContract("KahootFactory", [creationFee]);
  });

  it("joinGame fallos: falla si el monto enviado no es exactamente el entryFee", async function () {
    const r1e = buildRonda(1, profesor.account.address);
    await factory.write.createGame([1n, 1n, diplomaURI, [r1e], entryFee], { account: profesor.account, value: creationFee });
    const gameAddr = await factory.read.games([0n]);
    const prizeGame = await viem.getContractAt("KahootGame", gameAddr);

    await expectRevert(
      prizeGame.write.joinGame({ value: parseEther("0.005"), account: a1.account }),
      "Debes enviar exactamente el entryFee"
    );
    await expectRevert(
      prizeGame.write.joinGame({ value: parseEther("0.02"), account: a1.account }),
      "Debes enviar exactamente el entryFee"
    );
  });

  it("calculatePrizes prematuro: falla si el juego no ha terminado", async function () {
    const r1p = buildRonda(1, profesor.account.address);
    await factory.write.createGame([1n, 1n, diplomaURI, [r1p], entryFee], { account: profesor.account, value: creationFee });
    const gameAddr2 = await factory.read.games([0n]);
    const prizeGame2 = await viem.getContractAt("KahootGame", gameAddr2);

    await expectRevert(
      prizeGame2.write.calculatePrizes({ account: a1.account }),
      "El juego no ha terminado"
    );
  });

  it("Matemática, calculatePrizes y claimPrize (Ganadores y Profesor)", async function () {
    const r1m = buildRonda(1, profesor.account.address);
    const r2m = buildRonda(2, profesor.account.address);
    const r3m = buildRonda(3, profesor.account.address);

    await factory.write.createGame([2n, 3n, diplomaURI, [r1m, r2m, r3m], entryFee], { account: profesor.account, value: creationFee });
    const gameAddr = await factory.read.games([0n]);
    const prizeGame = await viem.getContractAt("KahootGame", gameAddr);

    await prizeGame.write.joinGame({ value: entryFee, account: a1.account });
    await prizeGame.write.joinGame({ value: entryFee, account: a2.account });
    await prizeGame.write.joinGame({ value: entryFee, account: a3.account });
    await prizeGame.write.joinGame({ value: entryFee, account: a4.account });
    await prizeGame.write.joinGame({ value: entryFee, account: a5.account });

    // --- PREGUNTA 1 ---
    await prizeGame.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
    await prizeGame.write.commitAnswer([generateHash(1, "s", a1.account.address)], { account: a1.account });
    await prizeGame.write.commitAnswer([generateHash(1, "s", a2.account.address)], { account: a2.account });
    await prizeGame.write.commitAnswer([generateHash(1, "s", a3.account.address)], { account: a3.account });
    await prizeGame.write.commitAnswer([generateHash(1, "s", a4.account.address)], { account: a4.account });
    await prizeGame.write.commitAnswer([generateHash(2, "s", a5.account.address)], { account: a5.account });
    
    await prizeGame.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    await prizeGame.write.revealAnswer([0n, 1, "s"], { account: a1.account });
    await prizeGame.write.revealAnswer([0n, 1, "s"], { account: a2.account });
    await prizeGame.write.revealAnswer([0n, 1, "s"], { account: a3.account });
    await prizeGame.write.revealAnswer([0n, 1, "s"], { account: a4.account });
    await prizeGame.write.revealAnswer([0n, 2, "s"], { account: a5.account });
    await prizeGame.write.advanceToNextQuestion({ account: profesor.account });

    // --- PREGUNTA 2 ---
    await prizeGame.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
    await prizeGame.write.commitAnswer([generateHash(2, "s", a1.account.address)], { account: a1.account });
    await prizeGame.write.commitAnswer([generateHash(2, "s", a2.account.address)], { account: a2.account });
    await prizeGame.write.commitAnswer([generateHash(2, "s", a3.account.address)], { account: a3.account });
    await prizeGame.write.commitAnswer([generateHash(1, "s", a4.account.address)], { account: a4.account });
    await prizeGame.write.commitAnswer([generateHash(1, "s", a5.account.address)], { account: a5.account });
    
    await prizeGame.write.closeQuestionAndStartReveal([2, profeSalt], { account: profesor.account });
    await prizeGame.write.revealAnswer([1n, 2, "s"], { account: a1.account });
    await prizeGame.write.revealAnswer([1n, 2, "s"], { account: a2.account });
    await prizeGame.write.revealAnswer([1n, 2, "s"], { account: a3.account });
    await prizeGame.write.revealAnswer([1n, 1, "s"], { account: a4.account });
    await prizeGame.write.revealAnswer([1n, 1, "s"], { account: a5.account });
    await prizeGame.write.advanceToNextQuestion({ account: profesor.account });

    // --- PREGUNTA 3 ---
    await prizeGame.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
    await prizeGame.write.commitAnswer([generateHash(3, "s", a1.account.address)], { account: a1.account });
    await prizeGame.write.commitAnswer([generateHash(3, "s", a2.account.address)], { account: a2.account });
    await prizeGame.write.commitAnswer([generateHash(1, "s", a3.account.address)], { account: a3.account });
    await prizeGame.write.commitAnswer([generateHash(1, "s", a4.account.address)], { account: a4.account });
    await prizeGame.write.commitAnswer([generateHash(1, "s", a5.account.address)], { account: a5.account });
    
    await prizeGame.write.closeQuestionAndStartReveal([3, profeSalt], { account: profesor.account });
    await prizeGame.write.revealAnswer([2n, 3, "s"], { account: a1.account });
    await prizeGame.write.revealAnswer([2n, 3, "s"], { account: a2.account });
    await prizeGame.write.revealAnswer([2n, 1, "s"], { account: a3.account });
    await prizeGame.write.revealAnswer([2n, 1, "s"], { account: a4.account });
    await prizeGame.write.revealAnswer([2n, 1, "s"], { account: a5.account });
    await prizeGame.write.advanceToNextQuestion({ account: profesor.account });
    
    await prizeGame.write.calculatePrizes({ account: a1.account });

    // Verificar matemáticas
    expect(await prizeGame.read.topScoreCounts([0n])).to.equal(2n);
    expect(await prizeGame.read.topScoreCounts([1n])).to.equal(1n);

    const publicClient = await viem.getPublicClient();
    
    const balanceProfeAntes = await publicClient.getBalance({ address: profesor.account.address });
    await prizeGame.write.claimPrize({ account: profesor.account });
    const balanceProfeDespues = await publicClient.getBalance({ address: profesor.account.address });
    expect(balanceProfeDespues > balanceProfeAntes).to.be.true;

    const balanceA1Antes = await publicClient.getBalance({ address: a1.account.address });
    await prizeGame.write.claimPrize({ account: a1.account });
    const balanceA1Despues = await publicClient.getBalance({ address: a1.account.address });
    expect(balanceA1Despues > balanceA1Antes).to.be.true;
  });

  it("claimPrize bloqueos (Reverts): Perdedor no puede retirar, y ganador no puede retirar dos veces", async function () {
    const r1c = buildRonda(1, profesor.account.address);
    const r2c = buildRonda(2, profesor.account.address);
    const r3c = buildRonda(3, profesor.account.address);
    await factory.write.createGame([1n, 3n, diplomaURI, [r1c, r2c, r3c], entryFee], { account: profesor.account, value: creationFee });
    const gameAddr = await factory.read.games([0n]);
    const lastGame = await viem.getContractAt("KahootGame", gameAddr);

    await lastGame.write.joinGame({ value: entryFee, account: a1.account });
    await lastGame.write.joinGame({ value: entryFee, account: a2.account });
    await lastGame.write.joinGame({ value: entryFee, account: a3.account });
    await lastGame.write.joinGame({ value: entryFee, account: a4.account });

    // PREGUNTA 1
    await lastGame.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
    await lastGame.write.commitAnswer([generateHash(1, "s", a1.account.address)], { account: a1.account });
    await lastGame.write.commitAnswer([generateHash(1, "s", a2.account.address)], { account: a2.account });
    await lastGame.write.commitAnswer([generateHash(1, "s", a3.account.address)], { account: a3.account });
    await lastGame.write.commitAnswer([generateHash(2, "s", a4.account.address)], { account: a4.account });
    await lastGame.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    await lastGame.write.revealAnswer([0n, 1, "s"], { account: a1.account });
    await lastGame.write.revealAnswer([0n, 1, "s"], { account: a2.account });
    await lastGame.write.revealAnswer([0n, 1, "s"], { account: a3.account });
    await lastGame.write.revealAnswer([0n, 2, "s"], { account: a4.account });
    await lastGame.write.advanceToNextQuestion({ account: profesor.account });

    // PREGUNTA 2
    await lastGame.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
    await lastGame.write.commitAnswer([generateHash(2, "s", a1.account.address)], { account: a1.account });
    await lastGame.write.commitAnswer([generateHash(2, "s", a2.account.address)], { account: a2.account });
    await lastGame.write.commitAnswer([generateHash(1, "s", a3.account.address)], { account: a3.account });
    await lastGame.write.commitAnswer([generateHash(1, "s", a4.account.address)], { account: a4.account });
    await lastGame.write.closeQuestionAndStartReveal([2, profeSalt], { account: profesor.account });
    await lastGame.write.revealAnswer([1n, 2, "s"], { account: a1.account });
    await lastGame.write.revealAnswer([1n, 2, "s"], { account: a2.account });
    await lastGame.write.revealAnswer([1n, 1, "s"], { account: a3.account });
    await lastGame.write.revealAnswer([1n, 1, "s"], { account: a4.account });
    await lastGame.write.advanceToNextQuestion({ account: profesor.account });

    // PREGUNTA 3
    await lastGame.write.startNextQuestion([enunciado, opciones, profeSalt], { account: profesor.account });
    await lastGame.write.commitAnswer([generateHash(3, "s", a1.account.address)], { account: a1.account });
    await lastGame.write.commitAnswer([generateHash(1, "s", a2.account.address)], { account: a2.account });
    await lastGame.write.commitAnswer([generateHash(1, "s", a3.account.address)], { account: a3.account });
    await lastGame.write.commitAnswer([generateHash(1, "s", a4.account.address)], { account: a4.account });
    await lastGame.write.closeQuestionAndStartReveal([3, profeSalt], { account: profesor.account });
    await lastGame.write.revealAnswer([2n, 3, "s"], { account: a1.account });
    await lastGame.write.revealAnswer([2n, 1, "s"], { account: a2.account });
    await lastGame.write.revealAnswer([2n, 1, "s"], { account: a3.account });
    await lastGame.write.revealAnswer([2n, 1, "s"], { account: a4.account });
    await lastGame.write.advanceToNextQuestion({ account: profesor.account });

    // Scores: a1=3, a2=2, a3=1, a4=0.
    await lastGame.write.calculatePrizes({ account: a1.account });

    await expectRevert(
      lastGame.write.claimPrize({ account: a4.account }),
      "Tu puntaje no esta en el top 3"
    );

    await lastGame.write.claimPrize({ account: a1.account });

    await expectRevert(
      lastGame.write.claimPrize({ account: a1.account }),
      "Ya retiraste tu premio"
    );
  });

});
