import { expect } from "chai";
import { network } from "hardhat";
import { describe, it, beforeEach } from "node:test";
import { keccak256, encodePacked, parseEther } from "viem";

describe("KahootGame - Flujo Principal (Core)", function () {
  let factory, game, diplomaNFT;
  let owner, profesor, alumnoHonesto, alumnoTramposo, alumnoExtra;
  let viem;

  const metadataURI = "ipfs://QmMockMetadata...";
  const diplomaURI = "ipfs://QmMockDiploma...";
  const profeSalt = "secretoProfe";
  const entryFee = parseEther("0.01");

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

    const walletClients = await viem.getWalletClients();
    [owner, profesor, alumnoHonesto, alumnoTramposo, alumnoExtra] = walletClients;

    factory = await viem.deployContract("KahootFactory");

    const hashRespuesta1 = generateHash(1, profeSalt, profesor.account.address);
    await factory.write.createGame(
      [1n, 1n, metadataURI, diplomaURI, [hashRespuesta1], entryFee],
      { account: profesor.account }
    );

    const gameAddress = await factory.read.games([0n]);
    game = await viem.getContractAt("KahootGame", gameAddress);
  });

  it("El copion no puede robar el hash", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.joinGame({ value: entryFee, account: alumnoTramposo.account });

    await game.write.startNextQuestion({ account: profesor.account });

    const hashHonesto = generateHash(1, "secreto", alumnoHonesto.account.address);
    
    await game.write.commitAnswer([hashHonesto], { account: alumnoHonesto.account });
    await game.write.commitAnswer([hashHonesto], { account: alumnoTramposo.account });

    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });

    await game.write.revealAnswer([0n, 1, "secreto"], { account: alumnoHonesto.account });
    expect(await game.read.scores([alumnoHonesto.account.address])).to.equal(1n);

    await expectRevert(
      game.write.revealAnswer([0n, 1, "secreto"], { account: alumnoTramposo.account }),
      "El hash no coincide"
    );
  });

  it("Partida completa de 3 preguntas (Loop completo)", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    const p2 = generateHash(2, profeSalt, profesor.account.address);
    const p3 = generateHash(2, profeSalt, profesor.account.address);

    await factory.write.createGame(
      [2n, 3n, metadataURI, diplomaURI, [p1, p2, p3], entryFee],
      { account: profesor.account }
    );
    const game3Address = await factory.read.games([1n]);
    const game3 = await viem.getContractAt("KahootGame", game3Address);

    await game3.write.joinGame({ value: entryFee, account: alumnoHonesto.account });

    // Q1
    await game3.write.startNextQuestion({ account: profesor.account });
    await game3.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    await game3.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account }); 
    await game3.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game3.write.advanceToNextQuestion({ account: profesor.account });

    // Q2
    await game3.write.startNextQuestion({ account: profesor.account });
    await game3.write.commitAnswer([generateHash(2, "s2", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    await game3.write.closeQuestionAndStartReveal([2, profeSalt], { account: profesor.account }); 
    await game3.write.revealAnswer([1n, 2, "s2"], { account: alumnoHonesto.account });
    await game3.write.advanceToNextQuestion({ account: profesor.account });

    // Q3
    await game3.write.startNextQuestion({ account: profesor.account });
    await game3.write.commitAnswer([generateHash(1, "s3", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    await game3.write.closeQuestionAndStartReveal([2, profeSalt], { account: profesor.account }); 
    await game3.write.revealAnswer([2n, 1, "s3"], { account: alumnoHonesto.account });
    await game3.write.advanceToNextQuestion({ account: profesor.account });

    expect(await game3.read.scores([alumnoHonesto.account.address])).to.equal(2n);
    expect(await game3.read.isFinished()).to.be.true;

    await game3.write.claimDiploma({ account: alumnoHonesto.account });
  });

  it("KahootGame - variables de estado", async function () {
    expect((await game.read.professor()).toLowerCase()).to.equal(profesor.account.address.toLowerCase());
    expect(await game.read.passingScore()).to.equal(1n);
    expect(await game.read.totalQuestions()).to.equal(1n);
    expect(await game.read.metadataURI()).to.equal(metadataURI);
    expect(await game.read.diplomaTokenURI()).to.equal(diplomaURI);
    expect(await game.read.isFinished()).to.be.false;
    expect(await game.read.currentQuestionId()).to.equal(0n);
  });

  it("Un alumno NO puede unirse después de que comience el juego", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await expectRevert(
      game.write.joinGame({ value: entryFee, account: alumnoTramposo.account }),
      "El juego ya comenzo o ya termino"
    );
  });

});
