// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiplomaNFT.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title KahootGame
 * @notice Contrato de juego Kahoot on-chain con diploma NFT y pozo de premios (Prize Pool).
 *
 * Mecánica del Prize Pool
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Cada jugador llama a joinGame() pagando el entryFee para registrarse.
 * 2. El pozo (prizePool) acumula todos los depósitos.
 * 3. Al finalizar el juego, cualquiera puede llamar a calculatePrizes() una sola vez.
 *    La función itera sobre los posibles puntajes (de mayor a menor) para encontrar
 *    los 3 puntajes más altos distintos — O(totalQuestions), muy eficiente en gas.
 * 4. Distribución: 1er puesto 60% / 2do 20% / 3er 10% / Profesor 10% + sobrantes.
 *    Si un puesto está vacante (ej. todos empataron en el 1er puntaje), su porcentaje
 *    se acumula al premio del profesor.
 *    El redondeo por división entera también se acumula al profesor para que nunca
 *    queden fondos atrapados en el contrato.
 * 5. Empates: el premio del rango se divide en partes iguales entre los empatados.
 * 6. Los ganadores (y el profesor) retiran con claimPrize(), protegido con nonReentrant.
 *
 * Seguimiento dinámico de scoreFrequency
 * ─────────────────────────────────────────────────────────────────────────────
 * En lugar de iterar sobre todos los jugadores al final, mantenemos un mapping
 *   scoreFrequency[score] => cantidad de jugadores con ese puntaje
 * que se actualiza en cada revealAnswer() correcto (2 SSTOREs por respuesta acertada).
 * Esto hace que calculatePrizes() solo necesite recorrer totalQuestions valores, sin
 * importar cuántos jugadores haya.
 */
contract KahootGame is ReentrancyGuard {
    // ─── Datos del juego ───────────────────────────────────────────────────────
    address public professor;
    DiplomaNFT public diplomaContract;

    uint256 public passingScore;
    uint256 public totalQuestions;
    uint256 public currentQuestionId;
    string public metadataURI;
    string public diplomaTokenURI;
    bytes32[] public correctAnswerCommits;
    mapping(uint256 => uint8) public revealedAnswers;
    bool public isFinished;

    struct Question {
        bool commitPhaseOpen;
        bool revealPhaseOpen;
    }

    mapping(uint256 => Question) public questions;
    mapping(uint256 => mapping(address => bytes32)) public commits;
    mapping(address => uint256) public scores;
    mapping(address => bool) public hasClaimed; // diploma

    // ─── Prize Pool ────────────────────────────────────────────────────────────
    uint256 public entryFee;
    uint256 public prizePool;
    mapping(address => bool) public hasJoined;

    // Seguimiento dinámico: cuántos jugadores tienen cada puntaje posible.
    // Se actualiza en joinGame() y en cada revealAnswer() correcto.
    mapping(uint256 => uint256) public scoreFrequency;

    // Estado post-calculatePrizes
    bool public prizesCalculated;
    uint256[3] public topScoreValues;          // los 3 puntajes más altos distintos
    uint256[3] public topScoreCounts;          // cantidad de jugadores en cada rango
    uint256[3] public prizePerPlayerAtRank;    // wei que recibe cada jugador del rango
    uint256 public professorPrize;             // total del profesor (10% base + sobrantes)

    mapping(address => bool) public hasPrizeClaimed;
    bool public professorPrizeClaimed;

    // ─── Eventos ───────────────────────────────────────────────────────────────
    event QuestionOpened(uint256 indexed questionId);
    event RevealPhaseStarted(uint256 indexed questionId);
    event DiplomaClaimed(address indexed student);
    event PlayerJoined(address indexed player, uint256 feePaid);
    event PrizesCalculated(uint256 rank1Score, uint256 rank2Score, uint256 rank3Score);
    event PrizeClaimed(address indexed recipient, uint256 amount);

    // ─── Modificadores ─────────────────────────────────────────────────────────
    modifier onlyProfessor() {
        require(msg.sender == professor, "Solo el profe puede ejecutar esto");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _professor,
        uint256 _passingScore,
        uint256 _totalQuestions,
        string memory _metadataURI,
        string memory _diplomaTokenURI,
        bytes32[] memory _correctAnswerCommits,
        uint256 _entryFee
    ) {
        require(_totalQuestions > 0, "Debe tener preguntas");
        require(_passingScore > 0, "Puntaje invalido");
        require(_passingScore <= _totalQuestions, "Puntaje mayor al total");
        require(_correctAnswerCommits.length == _totalQuestions, "Respuestas no coinciden");

        professor = _professor;
        passingScore = _passingScore;
        totalQuestions = _totalQuestions;
        metadataURI = _metadataURI;
        diplomaTokenURI = _diplomaTokenURI;
        correctAnswerCommits = _correctAnswerCommits;
        entryFee = _entryFee;

        diplomaContract = new DiplomaNFT(address(this));
    }

    // ─── Unirse al juego ───────────────────────────────────────────────────────

    /**
     * @notice Paga el entryFee y se registra como jugador.
     * Debe llamarse antes de commitAnswer(). El ETH enviado se suma al prizePool.
     */
    function joinGame() external payable {
        require(currentQuestionId == 0 && !questions[0].commitPhaseOpen, "El juego ya comenzo o ya termino");
        require(!hasJoined[msg.sender], "Ya te uniste al juego");
        require(msg.value == entryFee, "Debes enviar exactamente el entryFee");

        hasJoined[msg.sender] = true;
        prizePool += msg.value;
        // El jugador empieza con score 0; lo registramos en el histograma de frecuencias.
        scoreFrequency[0] += 1;

        emit PlayerJoined(msg.sender, msg.value);
    }

    // ─── Flujo del juego ───────────────────────────────────────────────────────

    function startNextQuestion() external onlyProfessor {
        require(!isFinished, "El juego termino");

        uint256 currentQ = currentQuestionId;
        if (currentQ > 0) {
            require(
                !questions[currentQ - 1].commitPhaseOpen && !questions[currentQ - 1].revealPhaseOpen,
                "Hay una pregunta activa"
            );
        }
        require(currentQ < totalQuestions, "No hay mas preguntas");

        questions[currentQ].commitPhaseOpen = true;
        emit QuestionOpened(currentQ);
    }

    function commitAnswer(bytes32 _commitHash) external {
        require(hasJoined[msg.sender], "Debes unirte primero con joinGame()");
        uint256 currentQ = currentQuestionId;
        require(questions[currentQ].commitPhaseOpen, "Fase de commit cerrada");
        require(_commitHash != bytes32(0), "Hash nulo");
        require(commits[currentQ][msg.sender] == bytes32(0), "Ya respondiste esta pregunta");

        commits[currentQ][msg.sender] = _commitHash;
    }

    function closeQuestionAndStartReveal(uint8 _correctOption, string memory _professorSalt) external onlyProfessor {
        uint256 currentQ = currentQuestionId;
        require(questions[currentQ].commitPhaseOpen, "No esta en fase de commit");

        bytes32 generatedHash = keccak256(abi.encodePacked(_correctOption, _professorSalt, msg.sender));
        require(generatedHash == correctAnswerCommits[currentQ], "Hash de respuesta incorrecto");

        revealedAnswers[currentQ] = _correctOption;
        questions[currentQ].commitPhaseOpen = false;
        questions[currentQ].revealPhaseOpen = true;

        emit RevealPhaseStarted(currentQ);
    }

    function revealAnswer(uint256 _questionId, uint8 _option, string memory _salt) external {
        require(hasJoined[msg.sender], "Debes unirte primero con joinGame()");
        require(questions[_questionId].revealPhaseOpen, "Fase de reveal cerrada");
        bytes32 storedCommit = commits[_questionId][msg.sender];
        require(storedCommit != bytes32(0), "No hiciste commit en esta pregunta");

        bytes32 generatedHash = keccak256(abi.encodePacked(_option, _salt, msg.sender));
        require(generatedHash == storedCommit, "El hash no coincide con tu commit");

        // Anulamos el commit para evitar doble-reveal
        commits[_questionId][msg.sender] = bytes32(0);

        if (_option == revealedAnswers[_questionId]) {
            // Actualizamos el histograma de frecuencias dinámicamente.
            // Decrementamos el puntaje anterior e incrementamos el nuevo.
            uint256 oldScore = scores[msg.sender];
            scoreFrequency[oldScore] -= 1;
            scores[msg.sender] = oldScore + 1;
            scoreFrequency[oldScore + 1] += 1;
        }
    }

    function advanceToNextQuestion() external onlyProfessor {
        uint256 currentQ = currentQuestionId;
        require(questions[currentQ].revealPhaseOpen, "Primero hay que abrir los reveals");

        questions[currentQ].revealPhaseOpen = false;
        currentQuestionId += 1;

        if (currentQuestionId == totalQuestions) {
            isFinished = true;
        }
    }

    // ─── Cálculo de premios ────────────────────────────────────────────────────

    /**
     * @notice Calcula y congela los premios. Puede ser llamada por cualquiera una vez
     * que el juego haya finalizado y haya un pozo de premios.
     *
     * Complejidad: O(totalQuestions) — itera sobre los puntajes posibles de mayor a menor
     * hasta encontrar los 3 puntajes más altos distintos. No itera sobre jugadores.
     *
     * Distribución:
     *   Rango 1 (puntaje más alto):    60% dividido entre los empatados
     *   Rango 2 (2do puntaje más alto): 20% dividido entre los empatados
     *   Rango 3 (3er puntaje más alto): 10% dividido entre los empatados
     *   Profesor:                       10% base + puestos vacantes + sobrantes de redondeo
     *
     * Los "sobrantes de redondeo" (wei perdidos por división entera) se acumulan al
     * profesor para garantizar que nunca queden fondos atrapados en el contrato.
     */
    function calculatePrizes() external {
        require(isFinished, "El juego no ha terminado");
        require(!prizesCalculated, "Los premios ya fueron calculados");
        require(prizePool > 0, "No hay pozo de premios para distribuir");

        prizesCalculated = true;

        // Encontrar los 3 puntajes más altos distintos con jugadores (O(totalQuestions))
        uint8 ranksFound = 0;
        for (uint256 i = totalQuestions; ranksFound < 3; ) {
            if (scoreFrequency[i] > 0) {
                topScoreValues[ranksFound] = i;
                topScoreCounts[ranksFound] = scoreFrequency[i];
                ranksFound++;
            }
            if (i == 0) break;
            i--;
        }

        // Montos brutos por rango (con división entera)
        uint256 rank1Total = (prizePool * 60) / 100;
        uint256 rank2Total = (prizePool * 20) / 100;
        uint256 rank3Total = (prizePool * 10) / 100;

        // El profesor empieza con 10% y acumula puestos vacantes + sobrantes de redondeo
        uint256 totalToPlayers = 0;

        if (ranksFound >= 1) {
            prizePerPlayerAtRank[0] = rank1Total / topScoreCounts[0];
            totalToPlayers += prizePerPlayerAtRank[0] * topScoreCounts[0];
        }
        // Si ranksFound < 1, rank1Total queda sin asignar → va al profesor vía el cálculo final

        if (ranksFound >= 2) {
            prizePerPlayerAtRank[1] = rank2Total / topScoreCounts[1];
            totalToPlayers += prizePerPlayerAtRank[1] * topScoreCounts[1];
        }

        if (ranksFound >= 3) {
            prizePerPlayerAtRank[2] = rank3Total / topScoreCounts[2];
            totalToPlayers += prizePerPlayerAtRank[2] * topScoreCounts[2];
        }

        // El profesor recibe todo lo restante: su 10% base + puestos vacantes + wei de redondeo
        professorPrize = prizePool - totalToPlayers;

        emit PrizesCalculated(
            ranksFound >= 1 ? topScoreValues[0] : 0,
            ranksFound >= 2 ? topScoreValues[1] : 0,
            ranksFound >= 3 ? topScoreValues[2] : 0
        );
    }

    // ─── Retiro de premios ─────────────────────────────────────────────────────

    /**
     * @notice Retira el premio del pozo correspondiente al caller.
     * - El profesor llama esta función para retirar su comisión.
     * - Los jugadores la llaman si su puntaje final coincide con alguno de los top 3.
     * - Es independiente de claimDiploma() y usa nonReentrant como protección.
     */
    function claimPrize() external nonReentrant {
        require(prizesCalculated, "Primero se debe llamar a calculatePrizes()");

        uint256 prize;

        if (msg.sender == professor) {
            require(!professorPrizeClaimed, "El profesor ya retiro su premio");
            require(professorPrize > 0, "No hay premio para el profesor");
            professorPrizeClaimed = true;
            prize = professorPrize;
        } else {
            require(hasJoined[msg.sender], "No participaste en este juego");
            require(!hasPrizeClaimed[msg.sender], "Ya retiraste tu premio");

            uint256 playerScore = scores[msg.sender];
            for (uint8 i = 0; i < 3; i++) {
                // topScoreCounts[i] == 0 indica que ese rango no existe (puesto vacante)
                if (topScoreCounts[i] > 0 && playerScore == topScoreValues[i]) {
                    prize = prizePerPlayerAtRank[i];
                    break;
                }
            }
            require(prize > 0, "Tu puntaje no esta en el top 3");
            hasPrizeClaimed[msg.sender] = true;
        }

        (bool success, ) = msg.sender.call{value: prize}("");
        require(success, "La transferencia de ETH fallo");
        emit PrizeClaimed(msg.sender, prize);
    }

    // ─── Diploma ───────────────────────────────────────────────────────────────

    function claimDiploma() external {
        require(isFinished, "El juego no ha terminado");
        require(!hasClaimed[msg.sender], "Ya reclamaste tu diploma");
        require(scores[msg.sender] >= passingScore, "No alcanzas el puntaje minimo");

        hasClaimed[msg.sender] = true;
        diplomaContract.mintDiploma(msg.sender, diplomaTokenURI);

        emit DiplomaClaimed(msg.sender);
    }
}
