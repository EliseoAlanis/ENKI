// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DiplomaNFT.sol";

contract KahootGame {
    address public professor;
    DiplomaNFT public diplomaContract;
    
    uint256 public passingScore;
    uint256 public totalQuestions;
    uint256 public currentQuestionId;
    string public metadataURI;
    string public diplomaTokenURI;
    uint8[] public correctAnswers;
    bool public isFinished;

    struct Question {
        bool commitPhaseOpen;
        bool revealPhaseOpen;
    }

    // Mapping por pregunta -> address -> hash
    mapping(uint256 => Question) public questions;
    mapping(uint256 => mapping(address => bytes32)) public commits;
    mapping(address => uint256) public scores;
    mapping(address => bool) public hasClaimed;

    event QuestionOpened(uint256 indexed questionId);
    event RevealPhaseStarted(uint256 indexed questionId);
    event DiplomaClaimed(address indexed student);

    modifier onlyProfessor() {
        require(msg.sender == professor, "Solo el profe puede ejecutar esto");
        _;
    }

    constructor(
        address _professor,
        uint256 _passingScore,
        uint256 _totalQuestions,
        string memory _metadataURI,
        string memory _diplomaTokenURI,
        uint8[] memory _correctAnswers
    ) {
        require(_totalQuestions > 0, "Debe tener preguntas");
        require(_passingScore > 0, "Puntaje invalido");
        require(_passingScore <= _totalQuestions, "Puntaje mayor al total");
        require(_correctAnswers.length == _totalQuestions, "Respuestas no coinciden");

        professor = _professor;
        passingScore = _passingScore;
        totalQuestions = _totalQuestions;
        metadataURI = _metadataURI;
        diplomaTokenURI = _diplomaTokenURI;
        correctAnswers = _correctAnswers;

        // CAMBIO CRÍTICO APLICADO: El contrato se pasa a sí mismo como argumento
        diplomaContract = new DiplomaNFT(address(this));
    }

    function startNextQuestion() external onlyProfessor {
        require(!isFinished, "El juego termino");
        
        uint256 currentQ = currentQuestionId;
        if (currentQ > 0) {
            require(!questions[currentQ - 1].commitPhaseOpen && !questions[currentQ - 1].revealPhaseOpen, "Hay una pregunta activa");
        }
        require(currentQ < totalQuestions, "No hay mas preguntas");
        
        questions[currentQ].commitPhaseOpen = true;
        emit QuestionOpened(currentQ);
    }

    function commitAnswer(bytes32 _commitHash) external {
        uint256 currentQ = currentQuestionId;
        require(questions[currentQ].commitPhaseOpen, "Fase de commit cerrada");
        require(commits[currentQ][msg.sender] == bytes32(0), "Ya respondiste");

        commits[currentQ][msg.sender] = _commitHash;
    }

    function closeQuestionAndStartReveal() external onlyProfessor {
        uint256 currentQ = currentQuestionId;
        require(questions[currentQ].commitPhaseOpen, "No esta en commit");

        questions[currentQ].commitPhaseOpen = false;
        questions[currentQ].revealPhaseOpen = true;

        emit RevealPhaseStarted(currentQ);
    }

    function revealAnswer(uint256 _questionId, uint8 _option, string memory _salt) external {
        require(questions[_questionId].revealPhaseOpen, "Fase de reveal cerrada");
        
        bytes32 storedCommit = commits[_questionId][msg.sender];
        require(storedCommit != bytes32(0), "No hiciste commit");
        
        // VULNERABILIDAD ARREGLADA: Atamos el hash a la billetera del que lo envia (msg.sender)
        bytes32 generatedHash = keccak256(abi.encodePacked(_option, _salt, msg.sender));
        require(generatedHash == storedCommit, "El hash no coincide");

        // Borramos el commit para evitar que revele dos veces
        commits[_questionId][msg.sender] = bytes32(0); 

        if (_option == correctAnswers[_questionId]) {
            scores[msg.sender] += 1;
        }
    }

    function advanceToNextQuestion() external onlyProfessor {
        uint256 currentQ = currentQuestionId;
        require(questions[currentQ].revealPhaseOpen, "Primero abrir reveals");
        
        questions[currentQ].revealPhaseOpen = false;
        currentQuestionId += 1;

        if (currentQuestionId == totalQuestions) {
            isFinished = true;
        }
    }

    function claimDiploma() external {
        require(isFinished, "El juego no ha terminado");
        require(!hasClaimed[msg.sender], "Ya reclamaste tu diploma");
        require(scores[msg.sender] >= passingScore, "No alcanzas el puntaje");

        hasClaimed[msg.sender] = true;
        diplomaContract.mintDiploma(msg.sender, diplomaTokenURI);
        
        emit DiplomaClaimed(msg.sender);
    }
}
