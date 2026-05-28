import { expect } from "chai";
import { network } from "hardhat";
import { describe, it, beforeEach } from "node:test";
import { keccak256, encodePacked, parseEther } from "viem";

describe("KahootGame - Rankings y Distribución de Premios", function () {
  let factory;
  let owner, profesor;
  let a1, a2, a3, a4, a5;
  let viem;

  const metadataURI = "ipfs://QmMockMetadata...";
  const diplomaURI = "ipfs://QmMockDiploma...";
  const profeSalt = "secretoProfe";
  const entryFee = parseEther("0.01");
  const creationFee = parseEther("0.001");

  function generateHash(opcion, salt, address) {
    return keccak256(encodePacked(["uint8", "string", "address"], [opcion, salt, address]));
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
    const networkContext = await network.create({ network: "hardhatMainnet", chainType: "l1" });
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

  // ─── Helper: juego de 1 pregunta ────────────────────────────────────────────

  /**
   * Despliega un juego de 1 pregunta (correcta = 1), hace unirse a los jugadores
   * indicados, corre la pregunta (los que están en `correct` aciertan, el resto falla)
   * y finaliza el juego. Devuelve el contrato.
   */
  async function run1QuestionGame(players, correct) {
    const commit = generateHash(1, profeSalt, profesor.account.address);
    await factory.write.createGame(
      [1n, 1n, metadataURI, diplomaURI, [commit], entryFee],
      { account: profesor.account, value: creationFee }
    );
    const count = await factory.read.getGamesCount();
    const gameAddr = await factory.read.games([count - 1n]);
    const game = await viem.getContractAt("KahootGame", gameAddr);

    for (const p of players) {
      await game.write.joinGame({ value: entryFee, account: p.account });
    }

    await game.write.startNextQuestion({ account: profesor.account });

    for (const p of players) {
      const option = correct.includes(p) ? 1 : 2;
      await game.write.commitAnswer(
        [generateHash(option, "s", p.account.address)],
        { account: p.account }
      );
    }

    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    for (const p of players) {
      const option = correct.includes(p) ? 1 : 2;
      await game.write.revealAnswer([0n, option, "s"], { account: p.account });
    }

    await game.write.advanceToNextQuestion({ account: profesor.account });

    return game;
  }

  // ─── Tests ──────────────────────────────────────────────────────────────────

  it("topScoreValues correctos con 3 rangos distintos (5 jugadores, 3 preguntas)", async function () {
    // Scores finales: a1=3, a2=3, a3=2, a4=1, a5=0
    // prizePool = 5 * 0.01 ETH = 0.05 ETH
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    const p2 = generateHash(2, profeSalt, profesor.account.address);
    const p3 = generateHash(3, profeSalt, profesor.account.address);

    await factory.write.createGame(
      [2n, 3n, metadataURI, diplomaURI, [p1, p2, p3], entryFee],
      { account: profesor.account, value: creationFee }
    );
    const gameAddr = await factory.read.games([0n]);
    const game = await viem.getContractAt("KahootGame", gameAddr);

    for (const p of [a1, a2, a3, a4, a5]) {
      await game.write.joinGame({ value: entryFee, account: p.account });
    }

    // Q0 (correct=1): a1,a2,a3,a4 aciertan; a5 falla
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s", a1.account.address)], { account: a1.account });
    await game.write.commitAnswer([generateHash(1, "s", a2.account.address)], { account: a2.account });
    await game.write.commitAnswer([generateHash(1, "s", a3.account.address)], { account: a3.account });
    await game.write.commitAnswer([generateHash(1, "s", a4.account.address)], { account: a4.account });
    await game.write.commitAnswer([generateHash(2, "s", a5.account.address)], { account: a5.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    await game.write.revealAnswer([0n, 1, "s"], { account: a1.account });
    await game.write.revealAnswer([0n, 1, "s"], { account: a2.account });
    await game.write.revealAnswer([0n, 1, "s"], { account: a3.account });
    await game.write.revealAnswer([0n, 1, "s"], { account: a4.account });
    await game.write.revealAnswer([0n, 2, "s"], { account: a5.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    // Q1 (correct=2): a1,a2,a3 aciertan; a4,a5 fallan
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(2, "s", a1.account.address)], { account: a1.account });
    await game.write.commitAnswer([generateHash(2, "s", a2.account.address)], { account: a2.account });
    await game.write.commitAnswer([generateHash(2, "s", a3.account.address)], { account: a3.account });
    await game.write.commitAnswer([generateHash(1, "s", a4.account.address)], { account: a4.account });
    await game.write.commitAnswer([generateHash(1, "s", a5.account.address)], { account: a5.account });
    await game.write.closeQuestionAndStartReveal([2, profeSalt], { account: profesor.account });
    await game.write.revealAnswer([1n, 2, "s"], { account: a1.account });
    await game.write.revealAnswer([1n, 2, "s"], { account: a2.account });
    await game.write.revealAnswer([1n, 2, "s"], { account: a3.account });
    await game.write.revealAnswer([1n, 1, "s"], { account: a4.account });
    await game.write.revealAnswer([1n, 1, "s"], { account: a5.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    // Q2 (correct=3): a1,a2 aciertan; a3,a4,a5 fallan
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(3, "s", a1.account.address)], { account: a1.account });
    await game.write.commitAnswer([generateHash(3, "s", a2.account.address)], { account: a2.account });
    await game.write.commitAnswer([generateHash(1, "s", a3.account.address)], { account: a3.account });
    await game.write.commitAnswer([generateHash(1, "s", a4.account.address)], { account: a4.account });
    await game.write.commitAnswer([generateHash(1, "s", a5.account.address)], { account: a5.account });
    await game.write.closeQuestionAndStartReveal([3, profeSalt], { account: profesor.account });
    await game.write.revealAnswer([2n, 3, "s"], { account: a1.account });
    await game.write.revealAnswer([2n, 3, "s"], { account: a2.account });
    await game.write.revealAnswer([2n, 1, "s"], { account: a3.account });
    await game.write.revealAnswer([2n, 1, "s"], { account: a4.account });
    await game.write.revealAnswer([2n, 1, "s"], { account: a5.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    await game.write.calculatePrizes({ account: a1.account });

    // Rangos: [3 (x2), 2 (x1), 1 (x1)]
    expect(await game.read.topScoreValues([0n])).to.equal(3n);
    expect(await game.read.topScoreValues([1n])).to.equal(2n);
    expect(await game.read.topScoreValues([2n])).to.equal(1n);

    expect(await game.read.topScoreCounts([0n])).to.equal(2n);
    expect(await game.read.topScoreCounts([1n])).to.equal(1n);
    expect(await game.read.topScoreCounts([2n])).to.equal(1n);

    // prizePool = 0.05 ETH
    // rank1 = 0.03 ETH / 2 = 0.015 ETH
    // rank2 = 0.01 ETH / 1 = 0.01 ETH
    // rank3 = 0.005 ETH / 1 = 0.005 ETH
    // profePrize = 0.05 - (0.03 + 0.01 + 0.005) = 0.005 ETH
    expect(await game.read.prizePerPlayerAtRank([0n])).to.equal(parseEther("0.015"));
    expect(await game.read.prizePerPlayerAtRank([1n])).to.equal(parseEther("0.01"));
    expect(await game.read.prizePerPlayerAtRank([2n])).to.equal(parseEther("0.005"));
    expect(await game.read.professorPrize()).to.equal(parseEther("0.005"));
  });

  it("Empate total: un solo rango distinto — profesor acumula rango 2 y 3", async function () {
    // 3 jugadores, 1 pregunta, todos aciertan → scores: a1=1, a2=1, a3=1
    // prizePool = 0.03 ETH
    // rank1Total = 0.018 ETH / 3 = 0.006 ETH por jugador
    // professorPrize = 0.03 - 0.018 = 0.012 ETH (10% base + rank2 vacante + rank3 vacante)
    const game = await run1QuestionGame([a1, a2, a3], [a1, a2, a3]);

    await game.write.calculatePrizes({ account: a1.account });

    expect(await game.read.topScoreValues([0n])).to.equal(1n);
    expect(await game.read.topScoreCounts([0n])).to.equal(3n);
    expect(await game.read.topScoreCounts([1n])).to.equal(0n); // rank2 vacante
    expect(await game.read.topScoreCounts([2n])).to.equal(0n); // rank3 vacante

    expect(await game.read.prizePerPlayerAtRank([0n])).to.equal(parseEther("0.006"));
    expect(await game.read.professorPrize()).to.equal(parseEther("0.012"));
  });

  it("Solo 2 rangos distintos: rank3 vacante — su pool pasa al profesor", async function () {
    // 3 jugadores, 1 pregunta: a1,a2 aciertan; a3 falla
    // Scores: a1=1, a2=1, a3=0
    // prizePool = 0.03 ETH
    // rank1 = 0.018 ETH / 2 = 0.009 ETH por jugador
    // rank2 = 0.006 ETH / 1 = 0.006 ETH (a3 con score 0)
    // rank3 vacante → 0.003 ETH pasa al profesor
    // professorPrize = 0.03 - (0.018 + 0.006) = 0.006 ETH
    const game = await run1QuestionGame([a1, a2, a3], [a1, a2]);

    await game.write.calculatePrizes({ account: a1.account });

    expect(await game.read.topScoreValues([0n])).to.equal(1n);
    expect(await game.read.topScoreValues([1n])).to.equal(0n); // a3 con score 0 es rank2
    expect(await game.read.topScoreCounts([0n])).to.equal(2n);
    expect(await game.read.topScoreCounts([1n])).to.equal(1n);
    expect(await game.read.topScoreCounts([2n])).to.equal(0n); // rank3 vacante

    expect(await game.read.prizePerPlayerAtRank([0n])).to.equal(parseEther("0.009"));
    expect(await game.read.prizePerPlayerAtRank([1n])).to.equal(parseEther("0.006"));
    expect(await game.read.prizePerPlayerAtRank([2n])).to.equal(0n); // vacante
    expect(await game.read.professorPrize()).to.equal(parseEther("0.006"));
  });

  it("Jugador con score 0 en rank2 puede reclamar su premio", async function () {
    // Mismo escenario: a3 tiene score 0 pero queda en rank2
    const game = await run1QuestionGame([a1, a2, a3], [a1, a2]);

    await game.write.calculatePrizes({ account: a1.account });

    const publicClient = await viem.getPublicClient();
    const antes = await publicClient.getBalance({ address: a3.account.address });
    await game.write.claimPrize({ account: a3.account });
    const despues = await publicClient.getBalance({ address: a3.account.address });

    expect(despues > antes).to.be.true;
  });

  it("Un solo jugador: gana rank1 solo, resto acumula al profesor", async function () {
    // 1 jugador, 1 pregunta, acierta → score=1
    // prizePool = 0.01 ETH
    // rank1Total = 0.006 ETH / 1 = 0.006 ETH
    // professorPrize = 0.01 - 0.006 = 0.004 ETH
    const game = await run1QuestionGame([a1], [a1]);

    await game.write.calculatePrizes({ account: a1.account });

    expect(await game.read.topScoreValues([0n])).to.equal(1n);
    expect(await game.read.topScoreCounts([0n])).to.equal(1n);
    expect(await game.read.topScoreCounts([1n])).to.equal(0n);
    expect(await game.read.topScoreCounts([2n])).to.equal(0n);

    expect(await game.read.prizePerPlayerAtRank([0n])).to.equal(parseEther("0.006"));
    expect(await game.read.professorPrize()).to.equal(parseEther("0.004"));
  });

  it("calculatePrizes no puede llamarse dos veces", async function () {
    const game = await run1QuestionGame([a1], [a1]);

    await game.write.calculatePrizes({ account: a1.account });

    await expectRevert(
      game.write.calculatePrizes({ account: a1.account }),
      "Los premios ya fueron calculados"
    );
  });

  it("calculatePrizes falla si no hay pozo de premios (entryFee = 0)", async function () {
    const commit = generateHash(1, profeSalt, profesor.account.address);
    await factory.write.createGame(
      [1n, 1n, metadataURI, diplomaURI, [commit], 0n],
      { account: profesor.account, value: creationFee }
    );
    const gameAddr = await factory.read.games([0n]);
    const game = await viem.getContractAt("KahootGame", gameAddr);

    await game.write.joinGame({ value: 0n, account: a1.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer(
      [generateHash(1, "s", a1.account.address)],
      { account: a1.account }
    );
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    await game.write.revealAnswer([0n, 1, "s"], { account: a1.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    await expectRevert(
      game.write.calculatePrizes({ account: a1.account }),
      "No hay pozo de premios para distribuir"
    );
  });

  it("prizesCalculated se setea en true luego de calculatePrizes", async function () {
    const game = await run1QuestionGame([a1], [a1]);

    expect(await game.read.prizesCalculated()).to.equal(false);
    await game.write.calculatePrizes({ account: a1.account });
    expect(await game.read.prizesCalculated()).to.equal(true);
  });

  it("Jugador sin premio no puede llamar claimPrize antes de calculatePrizes", async function () {
    const game = await run1QuestionGame([a1], [a1]);

    await expectRevert(
      game.write.claimPrize({ account: a1.account }),
      "Primero se debe llamar a calculatePrizes()"
    );
  });
});
